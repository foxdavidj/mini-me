import type { Reviews, ReviewItem } from "./review";

export type InboxClient = { verify():Promise<void>; inbox(id:string,present:boolean):Promise<"changed"|"unchanged"> };
export async function act(reviews:Reviews, action:"keep"|"reviewed"|"archive"|"undo", keys:string[], client:(email:string)=>InboxClient) {
  const results:{key:string;ok:boolean;message:string}[]=[];
  const all=reviews.items();
  for (const key of [...new Set(keys)]) {
    const item=all.find(x=>x.key===key);
    if (!item) { results.push({key,ok:false,message:"Item no longer available."});continue; }
    if (action === "keep" || action === "reviewed") {
      const result=reviews.store.db.query("UPDATE review_items SET status=? WHERE email=? AND id=? AND status='pending'").run(action==='keep'?'kept':'reviewed',item.email,item.id);
      results.push({key,ok:Boolean(result.changes),message:result.changes ? "Saved. Gmail is unchanged." : "Item already handled; refresh the queue."});continue;
    }
    results.push(await changeInbox(reviews,item,action,client));
  }
  return results;
}
async function changeInbox(reviews:Reviews,item:ReviewItem,action:"archive"|"undo",client:(email:string)=>InboxClient) {
  const key=item.key, now=new Date().toISOString(), db=reviews.store.db;
  const claimed=db.transaction(()=>{
    if (action==='archive') {
      const changed=db.query("UPDATE review_items SET status='archiving' WHERE email=? AND id=? AND status IN ('pending','kept','reviewed','answered','following_up')").run(item.email,item.id);
      if (!changed.changes) return false;
      db.query("INSERT INTO archive_actions VALUES (?,?,?,'archiving',?,?) ON CONFLICT(key) DO UPDATE SET state='archiving',updated_at=excluded.updated_at").run(key,item.email,item.id,now,now);
      return true;
    }
    return Boolean(db.query("UPDATE archive_actions SET state='restoring',updated_at=? WHERE key=? AND state IN ('archived','uncertain')").run(now,key).changes);
  })();
  if (!claimed) return {key,ok:false,message:"Item already handled or not eligible. Refresh the queue."};
  try {
    const gmail=client(item.email); await gmail.verify();
    const result=await gmail.inbox(item.id,action==='undo');
    const state=action==='undo'?'restored':result==='changed'?'archived':'skipped';
    db.transaction(()=>{
      db.query("UPDATE archive_actions SET state=?,updated_at=? WHERE key=?").run(state,new Date().toISOString(),key);
      reviews.status(item.email,item.id,action==='undo'?'kept':state==='skipped'?'reviewed':'archived');
    })();
    return {key,ok:true,message:action==='undo'?'Restored to inbox.':result==='changed'?'Archived. Unread state preserved.':'Already outside inbox; no change made.'};
  } catch {
    db.query("UPDATE archive_actions SET state='uncertain',updated_at=? WHERE key=?").run(new Date().toISOString(),key);
    reviews.status(item.email,item.id,'uncertain');
    return {key,ok:false,message:"Could not confirm Gmail’s response. Check Gmail or use Restore to inbox."};
  }
}
