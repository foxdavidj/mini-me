import { z } from "zod";
import type { Store } from "./store";
import type { InspectedMessage } from "./mail";

export const classificationSchema = z.object({
  items: z.array(z.object({
    id: z.string(), category: z.enum(["attention", "digest", "archive", "record", "keep"]),
    summary: z.string().min(1).max(1800), reason: z.string().min(1).max(800),
    group: z.string().min(1).max(100),
  }).strict()),
}).strict();
export type Classification = z.infer<typeof classificationSchema>["items"][number];
export type ReviewItem = Classification & {
  email: string; subject: string; from: string; receivedAt: string; threadId: string;
  status: string; key: string;
};
export const itemKey = (email: string, id: string) => `${email}:${id}`;

export class Reviews {
  constructor(readonly store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS review_runs (
        id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
        status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', processed INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS review_items (
        email TEXT NOT NULL, id TEXT NOT NULL, metadata TEXT NOT NULL, classification TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', run_id TEXT NOT NULL,
        PRIMARY KEY (email, id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS archive_actions (
        key TEXT PRIMARY KEY, email TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS question_answers (id INTEGER PRIMARY KEY, key TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, answered_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS review_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS label_actions (key TEXT PRIMARY KEY, labels TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS review_events (id INTEGER PRIMARY KEY, run_id TEXT, key TEXT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS daily_briefs (id TEXT PRIMARY KEY, run_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    `);
  }
  setting(key: string) { return this.store.db.query<{value:string},[string]>("SELECT value FROM review_settings WHERE key=?").get(key)?.value; }
  set(key: string, value: string) { this.store.db.query("INSERT INTO review_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value); }
  known(email: string) { return new Set(this.store.db.query<{id:string},[string]>("SELECT id FROM review_items WHERE email=?").all(email).map(x=>x.id)); }
  start(id: string) { this.store.db.query("INSERT INTO review_runs(id,started_at,status) VALUES (?,?,'running')").run(id,new Date().toISOString()); }
  finish(id:string,status:string,detail:string,count:number) { this.store.db.query("UPDATE review_runs SET finished_at=?,status=?,detail=?,processed=? WHERE id=?").run(new Date().toISOString(),status,detail,count,id); }
  log(key:string,action:string,state:string,detail:string,runId=process.env.MINI_ME_REVIEW_RUN_ID??null) {
    this.store.db.query('INSERT INTO review_events(run_id,key,action,state,detail,created_at) VALUES (?,?,?,?,?,?)').run(runId,key,action,state,detail,new Date().toISOString());
  }
  publishBrief(input:{runId?:string;title:string;body:string;reviewed:number;status:'success'|'partial'}) {
    const data=z.object({runId:z.string().optional(),title:z.string().trim().min(1).max(180),body:z.string().trim().min(1).max(50000),reviewed:z.number().int().min(0),status:z.enum(['success','partial'])}).strict().parse(input);
    const id=crypto.randomUUID(),now=new Date().toISOString();
    this.store.db.transaction(()=>{
      if(data.runId&&!this.store.db.query('SELECT id FROM review_runs WHERE id=?').get(data.runId))throw Error('Unknown run');
      this.store.db.query('INSERT INTO daily_briefs VALUES (?,?,?,?,?)').run(id,data.runId??null,data.title,data.body,now);
      if(data.runId)this.finish(data.runId,data.status,data.title,data.reviewed);
    })();
    return id;
  }
  save(email:string,messages:InspectedMessage[],results:Classification[],runId:string) {
    const ids = new Set(messages.map(x=>x.id));
    if (results.length !== messages.length || new Set(results.map(x=>x.id)).size !== messages.length || results.some(x=>!ids.has(x.id))) throw new Error("Review IDs do not match source messages");
    this.store.db.transaction(()=>{
      for (const result of results) {
        const message=messages.find(x=>x.id===result.id)!;
        const metadata={subject:message.subject,from:message.from,receivedAt:message.receivedAt,threadId:message.threadId};
        this.store.db.query("INSERT INTO review_items(email,id,metadata,classification,run_id) VALUES (?,?,?,?,?) ON CONFLICT(email,id) DO NOTHING").run(email,message.id,JSON.stringify(metadata),JSON.stringify(result),runId);
      }
    })();
  }
  items():ReviewItem[] {
    return this.store.db.query<{email:string;id:string;metadata:string;classification:string;status:string},[]>("SELECT email,id,metadata,classification,status FROM review_items ORDER BY json_extract(metadata, '$.receivedAt') DESC, email, id").all().map(row=>({
      ...JSON.parse(row.metadata),...JSON.parse(row.classification),email:row.email,status:row.status,key:itemKey(row.email,row.id),
    }));
  }
  status(email:string,id:string,status:string) { this.store.db.query("UPDATE review_items SET status=? WHERE email=? AND id=?").run(status,email,id); }
  answer(key:string, answer:string) {
    return this.store.db.transaction(()=>{
      const item=this.items().find(x=>x.key===key&&x.status==='pending'&&x.category==='attention');
      if(!item)throw Error('Question is no longer pending');
      this.store.db.query('INSERT INTO question_answers(key,question,answer,answered_at) VALUES (?,?,?,?)').run(key,item.summary,answer,new Date().toISOString());
      this.status(item.email,item.id,'answered');
      this.log(key,'answer','confirmed','Saved your answer for the next review.');
    })();
  }
  snapshot() {
    // A crashed web process may have changed Gmail without recording the response.
    // Keep those operations recoverable rather than permanently showing them busy.
    this.store.db.transaction(()=>{
      this.store.db.query("UPDATE archive_actions SET state='uncertain' WHERE state IN ('archiving','restoring') AND updated_at < ?").run(new Date(Date.now()-10*60*1000).toISOString());
      this.store.db.query("UPDATE review_items SET status='uncertain' WHERE EXISTS (SELECT 1 FROM archive_actions a WHERE a.email=review_items.email AND a.id=review_items.id AND a.state='uncertain')").run();
    })();
    return {
      items:this.items(),
      briefs:this.store.db.query('SELECT * FROM daily_briefs ORDER BY created_at DESC LIMIT 30').all(),
      events:this.store.db.query('SELECT * FROM review_events ORDER BY id DESC').all(),
      labelActions:this.store.db.query("SELECT key,labels,state,updated_at FROM label_actions ORDER BY updated_at DESC").all(),
      answers:this.store.db.query("SELECT key,question,answer,answered_at FROM question_answers ORDER BY id DESC").all(),
      runs:this.store.db.query("SELECT * FROM review_runs ORDER BY started_at DESC LIMIT 100").all(),
      accounts:this.store.accounts().map(x=>({email:x.email})),
      schedule:this.setting("schedule") ?? "Not scheduled",
      counts:JSON.parse(this.setting("counts") ?? "[]") as {email:string;inboxUnread:number;allUnread:number;remaining:boolean}[],
      undo:this.store.db.query("SELECT key,email,id,state FROM archive_actions WHERE state IN ('archived','uncertain','restoring','restored') ORDER BY created_at DESC").all(),
    };
  }
}
