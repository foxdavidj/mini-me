import { join, resolve } from 'node:path';
import { DEFAULT_DATA, privateDirectory } from './config';
import { Store } from './store';
import { Reviews } from './review';

export function finishReview(reviews:Reviews,id:string,code:number) {
 const published=reviews.store.db.query('SELECT id FROM daily_briefs WHERE run_id=?').get(id);
 if(code===0&&published)return true;
 const count=reviews.store.db.query<{processed:number},[string]>('SELECT processed FROM review_runs WHERE id=?').get(id)?.processed??0;
 reviews.finish(id,'failed',code!==0?'The personal review was interrupted. Confirmed actions remain in the run log.':'The reviewer ended without publishing a brief. Confirmed actions remain in the run log.',count);
 return false;
}

export async function runReview(scheduledDay?:string){
 process.umask(0o077);
 const store=new Store(DEFAULT_DATA),reviews=new Reviews(store),id=crypto.randomUUID();
 const acquired=store.db.transaction(()=>{
  const lock=reviews.setting('runner_pid');if(lock){try{process.kill(Number(lock),0);return false;}catch{}}
  if(scheduledDay&&reviews.setting('scheduled_day')===scheduledDay)return false;
  reviews.set('runner_pid',String(process.pid));if(scheduledDay)reviews.set('scheduled_day',scheduledDay);reviews.start(id);return true;
 })();
 if(!acquired){store.close();return;}
 try{
  const root=resolve(import.meta.dir,'..'),work=join(DEFAULT_DATA,'agent');privateDirectory(work);
  const instruction=await Bun.file(join(root,'agent-task.md')).text();
  const prompt=`${instruction}\nPrivate data directory: ${DEFAULT_DATA}\nRead ${join(DEFAULT_DATA,'memory.md')} and ${join(DEFAULT_DATA,'open-loops.md')} if present.\nMail tool: ${process.execPath} ${join(root,'src/mail-tool.ts')}\nReview run ID: ${id}. Include this runId in every decision and report JSON. Start with the ingest command. Write decision JSON and working notes under ${work}. Publish the daily brief using the report command. Update memory.md and open-loops.md as you learn and resolve things.\nToday: ${new Date().toISOString()}`;
  const flags=['apps','plugins','multi_agent','browser_use','computer_use','image_generation','hooks'];
  const child=Bun.spawn([process.env.MINI_ME_CODEX??'codex','exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','workspace-write','--cd',work,'--add-dir',DEFAULT_DATA,'-c','sandbox_workspace_write.network_access=true','-c','approval_policy="never"','-c','project_doc_max_bytes=0',...flags.flatMap(x=>['--disable',x]),'--output-last-message',join(DEFAULT_DATA,'agent-final.txt'),'-'],{env:{...process.env,MINI_ME_REVIEW_RUN_ID:id},stdin:'pipe',stdout:'ignore',stderr:'ignore'});
  child.stdin.write(prompt);child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),45*60*1000);
  const code=await child.exited;clearTimeout(timer);
  if(!finishReview(reviews,id,code))process.exitCode=1;
 }catch{reviews.finish(id,'failed','Personal review could not start. Check Codex sign-in.',0);process.exitCode=1;}
 finally{if(reviews.setting('runner_pid')===String(process.pid))store.db.query("DELETE FROM review_settings WHERE key='runner_pid'").run();store.close();}
}
if(import.meta.main)await runReview();
