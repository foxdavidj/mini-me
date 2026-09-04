import { chromium } from 'playwright';
import { DEFAULT_DATA, accessKey, readConfig } from '../src/config';

process.umask(0o077);
const origin=readConfig(DEFAULT_DATA+'/client_secret.json').origin;
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext(),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|violates/i.test(m.text()))errors.push('CSP failure');});
 await page.goto(origin+'/open/'+accessKey(DEFAULT_DATA),{waitUntil:'networkidle'});
 await page.getByRole('button',{name:/^Worth reading/}).click();
 await page.getByRole('heading',{name:'Worth reading',exact:true}).waitFor();
 await page.getByRole('button',{name:/^Ready to archive/}).click();
 const select=page.getByRole('checkbox',{name:'Select up to 50'});
 if(await select.count()){await select.check();if(!await page.getByRole('button',{name:/Archive selected/}).isEnabled())throw Error('Selection did not enable archive');await select.uncheck();}
 await page.setViewportSize({width:390,height:844});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 if(overflow)throw Error('Mobile horizontal overflow');
 await page.getByRole('link',{name:/Manage accounts/}).click();
 await page.getByRole('button',{name:/Connect a Google account/}).waitFor();
 if(errors.length)throw Error('Browser reported script errors');
 console.log('Dashboard hydration, tabs, archive selection, mobile layout, and account page passed. No mailbox changes made.');
 await context.close();
}catch{console.error('Dashboard browser check failed. Inspect the local page; sensitive browser diagnostics suppressed.');process.exitCode=1;}
finally{await browser.close();}
