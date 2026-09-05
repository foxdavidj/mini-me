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
 for(const label of ['Daily brief','Questions','Run log','Archive & history']){
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
 const items=Array.from({length:61},(_,i)=>({key:`test@example.com:${i}`,id:String(i),email:'test@example.com',from:'Example <sender@example.com>',subject:`Record ${i}`,receivedAt:'2026-09-04T00:00:00Z',threadId:String(i),status:i===0?'reviewed':'tagged',category:i===0?'attention':'record',summary:i===0?'An old question?':'Example record',reason:'Example',group:'Example'}));
 await page.route('**/api/review',route=>route.fulfill({json:{items,answers:[],csrf:'test',schedule:'Test',accounts:[],counts:[],runs:[{id:'test-run',started_at:'2026-09-04T00:00:00Z',status:'partial',processed:61,detail:'Test coverage'}],briefs:[{id:'brief-test',run_id:'test-run',title:'A useful morning',body:'**One thing.** [Open the record](/gmail?key=test%40example.com%3A0)',created_at:'2026-09-04T00:00:00Z'}],events:[{id:1,run_id:'test-run',key:'test@example.com:0',action:'label',state:'confirmed',detail:'Mini-me/Records',created_at:'2026-09-04T00:00:00Z'}],undo:[],message:null}}));
 await page.route('**/api/action',route=>{const body=route.request().postDataJSON() as {keys:string[]};batches.push(body.keys.length);return route.fulfill({json:body.keys.map(key=>({key,ok:true,message:'Test only'}))});});
 await page.goto(origin,{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'A useful morning'}).waitFor();
 if(await page.locator('.brief-prose strong').textContent()!=='One thing.')throw Error('Brief formatting missing');
 if(await page.getByRole('link',{name:'Open the record ↗'}).getAttribute('href')!=='/gmail?key=test%40example.com%3A0')throw Error('Brief Gmail link missing');
 await page.getByRole('button',{name:'See this run’s log'}).click();
 await page.locator('.event-log').getByText('Mini-me/Records',{exact:true}).waitFor();
 if(await page.getByRole('combobox',{name:'Review run'}).inputValue()!=='test-run')throw Error('Brief did not select its run');
 await page.getByRole('button',{name:/^Archive & history/}).click();
 await page.getByText('Question closed. No answer needed.',{exact:true}).waitFor();
 if(await page.getByText('An old question?',{exact:true}).isVisible())throw Error('Dismissed question still presented as active');
 await page.getByRole('checkbox',{name:'Select all'}).check();
 await page.getByRole('button',{name:'Archive selected (61)'}).click();
 await page.getByRole('status').filter({hasText:'61 of 61 saved.'}).waitFor();
 if(batches.join(',')!=='50,11')throw Error('Large selection was not fully submitted');
 if(errors.length)throw Error('Browser reported script errors');
 console.log('Daily brief, Gmail links, run log, tabs, archive selection, mobile layout, and account page passed. No mailbox changes made.');
 await context.close();
}catch{console.error('Dashboard browser check failed. Inspect the local page; sensitive browser diagnostics suppressed.');process.exitCode=1;}
finally{await browser.close();}
