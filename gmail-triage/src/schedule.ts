import { DEFAULT_DATA } from "./config";
import { Store } from "./store";
import { Reviews } from "./review";
import { runReview } from "./run-review";

export function dueDay(now:Date,lastDay:string|undefined):string|undefined{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=(name:string)=>parts.find(x=>x.type===name)!.value;
  const day=`${get('year')}-${get('month')}-${get('day')}`;
  return Number(get('hour'))>=6 && day!==lastDay?day:undefined;
}
if(import.meta.main){
  process.umask(0o077);
  const store=new Store(DEFAULT_DATA),reviews=new Reviews(store);
  const day=reviews.setting('schedule')==='Daily at 6 a.m. Pacific'?dueDay(new Date(),reviews.setting('scheduled_day')):undefined;
  store.close();if(day)await runReview(day);
}
