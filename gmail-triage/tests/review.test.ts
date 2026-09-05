import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store';
import { Reviews, itemKey } from '../src/review';
import { act } from '../src/actions';
import { dueDay } from '../src/schedule';
import { GmailReader } from '../src/mail';

const paths:string[]=[];afterEach(()=>{for(const p of paths.splice(0))rmSync(p,{recursive:true,force:true});});
function setup(){const path=mkdtempSync(join(tmpdir(),'mini-me-review-'));paths.push(path);const store=new Store(path),r=new Reviews(store);const message={id:'m1',threadId:'t1',from:'Sender',to:'me',subject:'Sale',receivedAt:'2026-09-04T00:00:00Z',text:'An optional sale',snippet:'',labels:['INBOX','UNREAD'],textTruncated:false,listId:''};const c={id:'m1',category:'archive' as const,summary:'Optional sale',reason:'Promotion',group:'Offers'};r.start('r1');r.save('one@example.com',[message],[c],'r1');return {store,r,message,c,path};}

test('reviews are mailbox-specific, deduplicated, and invalid results cannot partially save',()=>{
 const {store,r,message,c,path}=setup();
 r.status('one@example.com','m1','kept');r.save('one@example.com',[message],[c],'r1');r.save('two@example.com',[message],[c],'r1');
 expect(r.items()).toHaveLength(2);expect(r.items().find(x=>x.email==='one@example.com')?.status).toBe('kept');
 expect(()=>r.save('third@example.com',[message],[{...c,id:'invented'}],'r1')).toThrow();expect(r.known('third@example.com').size).toBe(0);
 store.close();const reopened=new Store(path);expect(new Reviews(reopened).items()).toHaveLength(2);reopened.close();
});
test('archive is applied once to the selected mailbox; undo is persistent and idempotent',async()=>{
 const {store,r}=setup(),key=itemKey('one@example.com','m1');const calls:unknown[]=[];const client=(email:string)=>({verify:async()=>{},inbox:async(id:string,present:boolean)=>{calls.push({email,id,present});return 'changed' as const;}});
 const results=await Promise.all([act(r,'archive',[key],client),act(r,'archive',[key],client)]);
 expect(results.flat().filter(x=>x.ok)).toHaveLength(1);expect(calls).toEqual([{email:'one@example.com',id:'m1',present:false}]);
 expect((await act(r,'undo',[key],client))[0]?.ok).toBe(true);expect((await act(r,'undo',[key],client))[0]?.ok).toBe(false);expect(calls).toHaveLength(2);expect(r.items()[0]?.status).toBe('kept');store.close();
});
test('failed archive remains uncertain and recoverable; records and attention can be archived',async()=>{
 const {store,r,message,c}=setup(),key=itemKey('one@example.com','m1');
 r.save('other@example.com',[message],[{...c,category:'attention'}],'r1');const client=()=>({verify:async()=>{},inbox:async()=>{throw new Error('timeout');}});
 const okClient=()=>({verify:async()=>{},inbox:async()=> 'changed' as const});
 expect((await act(r,'archive',[itemKey('other@example.com','m1')],okClient))[0]?.ok).toBe(true);
 r.save('records@example.com',[message],[{...c,category:'record'}],'r1');
 expect((await act(r,'archive',[itemKey('records@example.com','m1')],okClient))[0]?.ok).toBe(true);
 expect((await act(r,'archive',[key],client))[0]?.ok).toBe(false);expect(r.items().find(x=>x.key===key)?.status).toBe('uncertain');
 const undo=await act(r,'undo',[key],()=>({verify:async()=>{},inbox:async()=> 'changed'}));expect(undo[0]?.ok).toBe(true);store.close();
});
test('6 a.m. Pacific follows daylight saving time, catches up after sleep, and runs only once per day',()=>{
 expect(dueDay(new Date('2026-09-05T12:59:00Z'),undefined)).toBeUndefined();expect(dueDay(new Date('2026-09-05T13:00:00Z'),undefined)).toBe('2026-09-05');
 expect(dueDay(new Date('2026-12-05T13:59:00Z'),undefined)).toBeUndefined();expect(dueDay(new Date('2026-12-05T14:00:00Z'),undefined)).toBe('2026-12-05');
 expect(dueDay(new Date('2026-12-05T20:00:00Z'),'2026-12-04')).toBe('2026-12-05');expect(dueDay(new Date('2026-12-05T20:00:00Z'),'2026-12-05')).toBeUndefined();
});
test('Gmail archiving changes INBOX only and skips messages already archived',async()=>{
 const calls:{method:string;data?:unknown}[]=[];
 const reader=Object.create(GmailReader.prototype) as GmailReader;
 let labels=['INBOX','UNREAD','STARRED'];
 Object.assign(reader,{oauth:{request:async(options:{method:string;data?:{addLabelIds?:string[];removeLabelIds?:string[]}})=>{calls.push(options);if(options.method==='POST')labels=options.data?.addLabelIds?[...labels,'INBOX']:labels.filter(x=>x!=='INBOX');return{data:{labelIds:labels}};}}});
 expect(await reader.inbox('m1',false)).toBe('changed');expect(labels).toEqual(['UNREAD','STARRED']);expect(calls[1]?.data).toEqual({removeLabelIds:['INBOX']});
 expect(await reader.inbox('m1',false)).toBe('unchanged');expect(calls.filter(x=>x.method==='POST')).toHaveLength(1);
 expect(await reader.inbox('m1',true)).toBe('changed');expect(labels).toContain('UNREAD');
});

test('answers preserve the exact question across restarts and reject stale submissions',()=>{
 const {store,r,message,c,path}=setup();
 r.save('questions@example.com',[message],[{...c,category:'attention',summary:'Which account should stay active?'}],'r1');
 const key=itemKey('questions@example.com','m1');
 r.answer(key,'Keep the work account.');
 expect(()=>r.answer(key,'Duplicate response')).toThrow();
 expect(()=>r.answer(itemKey('one@example.com','m1'),'Not a question')).toThrow();
 store.close();const reopened=new Store(path),snapshot=new Reviews(reopened).snapshot();
 expect(snapshot.answers).toHaveLength(1);
 expect(snapshot.answers[0]).toMatchObject({key,question:'Which account should stay active?',answer:'Keep the work account.'});
 expect(snapshot.items.find(x=>x.key===key)?.status).toBe('answered');reopened.close();
});
