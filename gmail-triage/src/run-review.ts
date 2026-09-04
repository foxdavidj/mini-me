import { join } from "node:path";
import { DEFAULT_DATA, readConfig } from "./config";
import { Store } from "./store";
import { Reviews } from "./review";
import { GmailReader } from "./mail";
import { classify } from "./classify";

export async function runReview(scheduledDay?:string){
  process.umask(0o077);
  const store=new Store(DEFAULT_DATA),reviews=new Reviews(store),id=crypto.randomUUID();
  const acquired=store.db.transaction(()=>{
    const lock=reviews.setting('runner_pid');
    if(lock){try{process.kill(Number(lock),0);return false;}catch{/* Previous runner exited. */}}
    if(scheduledDay && reviews.setting('scheduled_day')===scheduledDay)return false;
    store.db.query("UPDATE review_runs SET status='failed',finished_at=?,detail='The previous review was interrupted. Saved results are preserved.' WHERE status='running'").run(new Date().toISOString());
    reviews.set('runner_pid',String(process.pid));
    if(scheduledDay)reviews.set('scheduled_day',scheduledDay);
    reviews.start(id);return true;
  })();
  if(!acquired){store.close();return;}
  let processed=0;
  const failures:string[]=[],counts:{email:string;inboxUnread:number;allUnread:number;remaining:boolean}[]=[];
  try{
    const config=readConfig(join(DEFAULT_DATA,'client_secret.json'));
    for(const {email} of store.accounts()){
      try{
        const {messages,...count}=await new GmailReader(config,store,email).unseen(reviews.known(email));counts.push(count);
        for(let start=0;start<messages.length;start+=15){
          const batch=messages.slice(start,start+15),result=await classify(email,batch);
          reviews.save(email,batch,result,id);processed+=batch.length;
          store.db.query("UPDATE review_runs SET processed=? WHERE id=?").run(processed,id);
        }
      }catch{failures.push(email);}
    }
    if(counts.length)reviews.set('counts',JSON.stringify(counts));
    const detail=failures.length?`Review incomplete for ${failures.join(', ')}. Check mailbox and Codex connections, then rerun. Existing reviews are preserved.`:processed?`Reviewed ${processed} new messages. Gmail was unchanged.`:'No new unread inbox messages to review.';
    reviews.finish(id,failures.length?'partial':'success',detail,processed);
    console.log(JSON.stringify({status:failures.length?'partial':'success',processed,failedAccounts:failures.length}));
    if(failures.length)process.exitCode=1;
  }catch{reviews.finish(id,'failed','The review could not start. Check local account connections and Codex sign-in.',processed);process.exitCode=1;}
  finally{if(reviews.setting('runner_pid')===String(process.pid))store.db.query("DELETE FROM review_settings WHERE key='runner_pid'").run();store.close();}
}
if(import.meta.main)await runReview();
