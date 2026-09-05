import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_DATA, hash, privateWrite, readConfig } from './config';
import { Store } from './store';
import { Reviews, itemKey } from './review';
import { assistantLabelName, GmailReader } from './mail';
import { act } from './actions';
import { completeLabeledReview, tagMail } from './labels';

// I/O only. The agent reads messages and supplies its own decisions.
process.umask(0o077);
const command=Bun.argv[2];
const {values}=parseArgs({args:Bun.argv.slice(3),options:{key:{type:'string'},email:{type:'string'},query:{type:'string'},file:{type:'string'},html:{type:'boolean'}}});
const store=new Store(DEFAULT_DATA),reviews=new Reviews(store),config=readConfig(join(DEFAULT_DATA,'client_secret.json'));
const pathFor=(key:string)=>join(DEFAULT_DATA,'mail',hash(key)+'.json');
const reader=(email:string)=>new GmailReader(config,store,email);
const decisionSchema=z.object({runId:z.string().optional(),items:z.array(z.object({key:z.string(),action:z.enum(['archive','question','keep','label']),reason:z.string().min(1),question:z.string().optional(),labels:z.array(assistantLabelName).min(1).max(8).optional(),complete:z.boolean().optional()}).strict()).max(1000)}).strict();
try{
 if(command==='ingest'){
  const counts=[];
  for(const {email} of store.accounts()){
   const result=await reader(email).unseen(reviews.known(email),500,message=>{
    privateWrite(pathFor(itemKey(email,message.id)),JSON.stringify({email,...message},null,2));
    reviews.save(email,[message],[{id:message.id,category:'keep',group:message.from,summary:'Awaiting personal review.',reason:'No triage decision has been made.'}],'ingestion');
   });
   counts.push({email,inboxUnread:result.inboxUnread,allUnread:result.allUnread,remaining:result.remaining});
  }
  for(const item of reviews.items().filter(x=>['pending','answered','following_up'].includes(x.status)))if(!await Bun.file(pathFor(item.key)).exists())privateWrite(pathFor(item.key),JSON.stringify({email:item.email,...await reader(item.email).message(item.id)},null,2));
  reviews.set('counts',JSON.stringify(counts));
  const manifest={answers:reviews.snapshot().answers,createdAt:new Date().toISOString(),counts,messages:reviews.items().map(x=>({...x,path:pathFor(x.key)}))};
  const path=join(DEFAULT_DATA,'inbox-manifest.json');privateWrite(path,JSON.stringify(manifest,null,2));console.log(JSON.stringify({manifest:path,pending:manifest.messages.filter(x=>['pending','answered'].includes(x.status)).length}));
 }else if(command==='read'){
  const item=reviews.items().find(x=>x.key===values.key);if(!item)throw Error('Unknown message');
  const message=await reader(item.email).message(item.id,values.html);privateWrite(pathFor(item.key),JSON.stringify({email:item.email,...message},null,2));console.log(JSON.stringify({email:item.email,...message}));
 }else if(command==='search'){
  if(!values.email||!values.query||!store.accounts().some(x=>x.email===values.email))throw Error('Specify a connected mailbox and query');
  const result=await reader(values.email).inspect(100,values.query);
  const messages=result.messages.map(message=>{const key=itemKey(values.email!,message.id);privateWrite(pathFor(key),JSON.stringify({email:values.email,...message},null,2));return{key,subject:message.subject,from:message.from,receivedAt:message.receivedAt,path:pathFor(key)};});console.log(JSON.stringify({messages,moreMatches:result.moreMatches}));
 }else if(command==='labels'){
  if(!values.email||!store.accounts().some(x=>x.email===values.email))throw Error('Specify a connected mailbox');
  const gmail=reader(values.email);await gmail.verify();console.log(JSON.stringify(await gmail.labels()));
 }else if(command==='report'){
  if(!values.file)throw Error('Specify a report file');
  const report=await Bun.file(values.file).json();
  const id=reviews.publishBrief({...report,runId:report.runId??process.env.MINI_ME_REVIEW_RUN_ID});
  privateWrite(join(DEFAULT_DATA,'brief.md'),report.body);console.log(JSON.stringify({brief:id}));
 }else if(command==='apply'){
  if(!values.file)throw Error('Specify a decision file');
  const plan=decisionSchema.parse(await Bun.file(values.file).json());
  if(plan.runId){if(!store.db.query('SELECT id FROM review_runs WHERE id=?').get(plan.runId))throw Error('Unknown run');process.env.MINI_ME_REVIEW_RUN_ID=plan.runId;}
  if(new Set(plan.items.map(x=>x.key)).size!==plan.items.length)throw Error('Duplicate decisions');
  // Validate the complete plan before applying any part.
  const items=reviews.items();
  for(const decision of plan.items){if(!items.some(x=>x.key===decision.key))throw Error('Unknown message');if(decision.action==='question'&&!decision.question?.trim())throw Error('A question needs question text');if(decision.action!=='archive'&&!decision.labels?.length)throw Error('Useful mail needs Gmail labels');}
  privateWrite(join(DEFAULT_DATA,'reports',`agent-decisions-${Date.now()}.json`),JSON.stringify(plan,null,2));
  const archives=[];
  const tagged:{key:string;ok:boolean;labels:string[]}[]=[];
  for(const decision of plan.items){
   const item=items.find(x=>x.key===decision.key)!;
   if(['archiving','uncertain'].includes(item.status))continue;
   if(decision.action!=='label'&&!['pending','answered','following_up'].includes(item.status))continue;
   if(decision.labels){const result=await tagMail(reviews,{...item,reason:decision.reason},decision.labels,reader(item.email));tagged.push(result);if(!result.ok)continue;}
   if(decision.action==='label'){
    if(decision.complete!==false)completeLabeledReview(reviews,item,decision.reason);
    continue;
   }
   const classification={id:item.id,category:decision.action==='question'?'attention':decision.action==='archive'?'archive':'keep',group:item.group,summary:decision.action==='question'?decision.question:decision.reason,reason:decision.reason};
   const changed=store.db.query("UPDATE review_items SET classification=? WHERE email=? AND id=? AND status IN ('pending','answered','following_up')").run(JSON.stringify(classification),item.email,item.id);
   if(changed.changes&&decision.action==='archive')archives.push(item.key);
   if(changed.changes&&decision.action==='question')reviews.status(item.email,item.id,'pending');
   if(changed.changes&&decision.action==='keep')reviews.status(item.email,item.id,'following_up');
   if(changed.changes&&decision.action!=='archive')reviews.log(item.key,decision.action,'confirmed',decision.action==='question'?decision.question!:decision.reason);
  }
  const results=await act(reviews,'archive',archives,reader);
  console.log(JSON.stringify({archived:results.filter(x=>x.ok).length,tagged:tagged.filter(x=>x.ok).length,failed:[...results.filter(x=>!x.ok),...tagged.filter(x=>!x.ok)]}));
  if(results.some(x=>!x.ok)||tagged.some(x=>!x.ok))process.exitCode=1;
 }else if(command==='status')console.log(JSON.stringify(reviews.snapshot()));
 else throw Error('Use ingest, read --key, search --email --query, labels --email, apply --file, report --file, or status');
}catch{console.error('Mail operation failed. Private account diagnostics suppressed.');process.exitCode=1;}finally{store.close();}
