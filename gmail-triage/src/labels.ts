import type { Reviews, ReviewItem } from './review';

export type LabelClient = {tag(id:string,names:string[]):Promise<{labels:{id:string;name:string}[];changed:boolean}>};

export function completeLabeledReview(reviews:Reviews,item:ReviewItem,reason:string) {
  // Useful mail is now handled in Gmail. Preserve explicit user decisions and unanswered questions.
  const changed=reviews.store.db.query("UPDATE review_items SET status='tagged',classification=? WHERE email=? AND id=? AND status IN ('pending','answered','following_up','tagged') AND NOT (status='pending' AND json_extract(classification,'$.category')='attention')").run(JSON.stringify({id:item.id,category:'keep',group:item.group,summary:reason,reason}),item.email,item.id);
  return Boolean(changed.changes);
}

// Additive and safe to retry. A failed request never marks the review complete.
export async function tagMail(reviews:Reviews,item:ReviewItem,names:string[],client:LabelClient) {
  const now=new Date().toISOString();
  reviews.store.db.query("INSERT INTO label_actions(key,labels,state,updated_at) VALUES (?,?,'pending',?) ON CONFLICT(key) DO UPDATE SET labels=excluded.labels,state='pending',updated_at=excluded.updated_at").run(item.key,JSON.stringify(names),now);
  try {
    const result=await client.tag(item.id,names);
    reviews.store.db.query("UPDATE label_actions SET state='confirmed',updated_at=? WHERE key=?").run(new Date().toISOString(),item.key);
    reviews.log(item.key,'label','confirmed',`${result.labels.map(x=>x.name).join(', ')}. ${item.reason}`);
    return {key:item.key,ok:true,labels:result.labels.map(x=>x.name)};
  } catch {
    reviews.store.db.query("UPDATE label_actions SET state='uncertain',updated_at=? WHERE key=?").run(new Date().toISOString(),item.key);
    reviews.log(item.key,'label','uncertain','Could not confirm Gmail labels; safe to retry.');
    return {key:item.key,ok:false,labels:names};
  }
}
