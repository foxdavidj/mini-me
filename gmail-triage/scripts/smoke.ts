import { chromium } from 'playwright';
import { DEFAULT_DATA, accessKey, readConfig } from '../src/config';

process.umask(0o077);
const origin=readConfig(DEFAULT_DATA+'/client_secret.json').origin;
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|violates/i.test(m.text()))errors.push('CSP failure');});
 await page.goto(origin+'/open/'+accessKey(DEFAULT_DATA),{waitUntil:'networkidle'});
 if(await page.getByRole('button',{name:/^Saved reading/}).count())throw Error('Duplicate reading queue remains');
 for(const label of ['Questions','Ready to archive','Records & other','Recent activity']){
  await page.getByRole('button',{name:new RegExp('^'+label)}).click();
  await page.getByRole('heading',{name:label,exact:true}).waitFor();
  const select=page.getByRole('checkbox',{name:'Select all'});
  if(await select.count()){await select.check();if(!await page.getByRole('button',{name:/Archive selected/}).isEnabled())throw Error('Selection did not enable archive');await select.uncheck();}
 }
 await page.getByRole('button',{name:/^Questions/}).click();
 await page.setViewportSize({width:390,height:844});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 if(overflow)throw Error('Mobile horizontal overflow');
 await page.getByRole('link',{name:/Manage accounts/}).click();
 await page.getByRole('button',{name:/Connect a Google account/}).waitFor();
 // Exercise large selections against synthetic responses, never the live action API.
 const batches:number[]=[];
 const items=Array.from({length:61},(_,i)=>({key:`test@example.com:${i}`,id:String(i),email:'test@example.com',from:'Example <sender@example.com>',subject:`Record ${i}`,receivedAt:'2026-09-04T00:00:00Z',threadId:String(i),status:'pending',category:'record',summary:'Example record',reason:'Example',group:'Example'}));
 await page.route('**/api/review',route=>route.fulfill({json:{items,answers:[],csrf:'test',schedule:'Test',accounts:[],counts:[],runs:[],undo:[],message:null}}));
 await page.route('**/api/action',route=>{const body=route.request().postDataJSON() as {keys:string[]};batches.push(body.keys.length);return route.fulfill({json:body.keys.map(key=>({key,ok:true,message:'Test only'}))});});
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:/^Records & other/}).click();
 await page.getByRole('checkbox',{name:'Select all'}).check();
 await page.getByRole('button',{name:'Archive selected (61)'}).click();
 await page.getByRole('status').filter({hasText:'61 of 61 saved.'}).waitFor();
 if(batches.join(',')!=='50,11')throw Error('Large selection was not fully submitted');
 if(errors.length)throw Error('Browser reported script errors');
 console.log('Dashboard hydration, tabs, archive selection, mobile layout, and account page passed. No mailbox changes made.');
 await context.close();
}catch{console.error('Dashboard browser check failed. Inspect the local page; sensitive browser diagnostics suppressed.');process.exitCode=1;}
finally{await browser.close();}
