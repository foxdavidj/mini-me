import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GmailReader } from '../src/mail';
import { Store } from '../src/store';
import { Reviews } from '../src/review';
import { completeLabeledReview, tagMail } from '../src/labels';

function mailbox(initial:string[]) {
  const reader=Object.create(GmailReader.prototype) as GmailReader;
  let messageLabels=[...initial];
  const labels=[{id:'existing-records',name:'Mini-me/Records',type:'user'}];
  const writes:{url:string;data:Record<string,unknown>}[]=[];
  Object.assign(reader,{verify:async()=>{},get:async(path:string)=>path==='labels'?{labels}:{labelIds:messageLabels},oauth:{request:async(request:{url:string;data:Record<string,unknown>})=>{
    writes.push(request);
    if(request.url.endsWith('/labels')) {const label={id:'created-read',name:request.data.name as string,type:'user'};labels.push(label);return {data:label};}
    messageLabels=[...new Set([...messageLabels,...request.data.addLabelIds as string[]])];return {data:{labelIds:messageLabels}};
  }}});
  return {reader,writes,state:()=>messageLabels};
}

test('Gmail tagging reuses labels, creates missing ones, and preserves inbox/unread/user labels',async()=>{
  const {reader,writes,state}=mailbox(['INBOX','UNREAD','STARRED','personal-label']);
  await reader.tag('one',['Mini-me/Records','Mini-me/Read']);
  expect(state()).toEqual(['INBOX','UNREAD','STARRED','personal-label','existing-records','created-read']);
  expect(writes[1]?.data).toEqual({addLabelIds:['existing-records','created-read']});
  expect((await reader.tag('one',['Mini-me/Records','Mini-me/Read'])).changed).toBe(false);
  expect(writes).toHaveLength(2);
});

test('tagging archived mail does not restore it and cannot write arbitrary system labels',async()=>{
  const {reader,writes,state}=mailbox(['UNREAD','personal-label']);
  await reader.tag('one',['Mini-me/Records']);
  expect(state()).toEqual(['UNREAD','personal-label','existing-records']);
  await expect(reader.tag('one',['TRASH'])).rejects.toThrow();
  await expect(reader.tag('one',['INBOX'])).rejects.toThrow();
  expect(writes).toHaveLength(1);
  const trashed=mailbox(['TRASH','UNREAD']);
  await expect(trashed.reader.tag('one',['Mini-me/Records'])).rejects.toThrow();
  expect(trashed.writes).toHaveLength(0);
});

test('unconfirmed label writes remain retryable and do not replace a user decision',async()=>{
  const path=mkdtempSync(join(tmpdir(),'mini-me-labels-')),store=new Store(path),reviews=new Reviews(store);
  try {
    const message={id:'one',threadId:'thread',from:'Sender',to:'me',subject:'Receipt',receivedAt:'2026-09-04T00:00:00Z',text:'Paid',snippet:'',labels:['INBOX','UNREAD'],textTruncated:false,listId:''};
    reviews.save('me@example.com',[message],[{id:'one',category:'keep',group:'Sender',summary:'Receipt',reason:'Paid record'}],'test');
    reviews.status('me@example.com','one','reviewed');
    const item=reviews.items()[0]!;
    expect((await tagMail(reviews,item,['Mini-me/Records'],{tag:async()=>{throw Error('Connection lost');}})).ok).toBe(false);
    expect(reviews.snapshot().labelActions[0]).toMatchObject({state:'uncertain'});
    expect(reviews.items()[0]?.status).toBe('reviewed');
    expect((await tagMail(reviews,item,['Mini-me/Records'],{tag:async()=>({changed:false,labels:[{id:'record',name:'Mini-me/Records'}]})})).ok).toBe(true);
    expect(reviews.snapshot().labelActions[0]).toMatchObject({state:'confirmed'});
    completeLabeledReview(reviews,item,'Filed in Gmail');
    expect(reviews.items()[0]?.status).toBe('reviewed');
    reviews.status(item.email,item.id,'following_up');
    completeLabeledReview(reviews,item,'Resolved and labeled for reference');
    expect(reviews.items()[0]?.status).toBe('tagged');
  } finally {store.close();rmSync(path,{recursive:true,force:true});}
});
