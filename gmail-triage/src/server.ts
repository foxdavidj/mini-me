import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createApp } from "./app";
import { DEFAULT_DATA, accessKey, equal, readConfig, secret } from "./config";
import { Store } from "./store";
import { googleAuth } from "./google";
import { GmailReader } from "./mail";
import { Reviews } from "./review";
import { act } from "./actions";
import { nonceContext } from "./nonce.server";
import { gmailDestination } from './gmail-link';

process.umask(0o077);
const dataDir=process.env.MINI_ME_DATA_DIR ?? DEFAULT_DATA;
const config=readConfig(join(dataDir,"client_secret.json"));
const store=new Store(dataDir), reviews=new Reviews(store);
const actionSchema=z.object({action:z.enum(["keep","reviewed","archive","undo"]),keys:z.array(z.string().max(400)).min(1).max(50),csrf:z.string()}).strict();
const app=createApp({config,store,google:googleAuth(config),accessKey:accessKey(dataDir),css:readFileSync(join(process.cwd(),"static/style.css"),"utf8"),
  dashboard:async(request,session)=>{
    const path=new URL(request.url).pathname;
    if(path==='/gmail'&&request.method==='GET') {
      const params=new URL(request.url).searchParams,key=params.get('key');
      if(key){const item=reviews.items().find(x=>x.key===key);if(!item)return new Response('Not found',{status:404});return Response.redirect(gmailDestination(item.email,item.threadId),302);}
      const email=params.get('email'),label=params.get('label')??undefined;
      if(!email||!store.accounts().some(x=>x.email===email)||label&&!label.startsWith('Mini-me/'))return new Response('Not found',{status:404});
      return Response.redirect(gmailDestination(email,undefined,label),302);
    }
    if (path==='/api/review' && request.method==='GET') return Response.json({...reviews.snapshot(),csrf:session.csrf,message:session.message});
    if (path==='/api/message' && request.method==='GET') {
      const key=new URL(request.url).searchParams.get('key');
      const item=reviews.items().find(x=>x.key===key);
      if(!item)return new Response('Not found',{status:404});
      const gmail=new GmailReader(config,store,item.email);await gmail.verify();
      const message=await gmail.message(item.id);
      return Response.json({text:message.text,textTruncated:message.textTruncated});
    }
    if (path==='/api/answer' && request.method==='POST') {
      if(request.headers.get('Origin')!==config.origin)return new Response('Forbidden',{status:403});
      const body=await request.text();if(body.length>16000)return new Response('Too large',{status:413});
      const parsed=z.object({key:z.string(),answer:z.string().trim().min(1).max(8000),csrf:z.string()}).strict().safeParse(JSON.parse(body));
      if(!parsed.success||!equal(parsed.data.csrf,session.csrf))return new Response('Forbidden',{status:403});
      reviews.answer(parsed.data.key,parsed.data.answer);return Response.json({saved:true});
    }
    if (path==='/api/action' && request.method==='POST') {
      if (request.headers.get('Origin')!==config.origin) return new Response('Forbidden',{status:403});
      const body=await request.text(); if(body.length>20000) return new Response('Too large',{status:413});
      const parsed=actionSchema.safeParse(JSON.parse(body));
      if (!parsed.success || !equal(parsed.data.csrf,session.csrf)) return new Response('Forbidden',{status:403});
      return Response.json(await act(reviews,parsed.data.action,parsed.data.keys,email=>new GmailReader(config,store,email)));
    }
    if (path.startsWith('/api/')) return new Response('Not found',{status:404});
    const nonce=secret();
    const response=await nonceContext.run(nonce,()=>handler.fetch(request));
    response.headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'`);
    return response;
  },
});
export default createServerEntry({async fetch(request){
  const response=await app(request);
  response.headers.set('Cache-Control','no-store');
  response.headers.set('X-Content-Type-Options','nosniff');
  if (!response.headers.has('Content-Security-Policy')) response.headers.set('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (!response.headers.has('Referrer-Policy')) response.headers.set('Referrer-Policy','same-origin');
  return response;
}});
