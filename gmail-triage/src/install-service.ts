import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_DATA, privateDirectory } from './config';
import { Store } from './store';
import { Reviews } from './review';

if(process.platform!=='darwin')throw new Error('This installer uses macOS launchd.');
const root=resolve(import.meta.dir,'..'),agents=join(homedir(),'Library/LaunchAgents');
if(!existsSync(join(root,'.output/server/index.mjs')))throw new Error('Run bun run build first.');
const codex=Bun.which('codex');if(!codex)throw new Error('Install and sign in to Codex first.');
privateDirectory(DEFAULT_DATA);mkdirSync(agents,{recursive:true});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const domain=`gui/${process.getuid!()}`;
for(const job of [
  {label:'com.mini-me.gmail-web',args:[process.execPath,join(root,'.output/server/index.mjs')],extra:'<key>KeepAlive</key><true/>'},
  {label:'com.mini-me.gmail-review',args:[process.execPath,join(root,'src/schedule.ts')],extra:'<key>StartInterval</key><integer>60</integer>'},
]){
 const path=join(agents,job.label+'.plist');
 const env={HOME:homedir(),PATH:[dirname(process.execPath),dirname(codex),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),MINI_ME_CODEX:codex,HOST:'127.0.0.1',PORT:'8765'};
 const xml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
 <key>Label</key><string>${job.label}</string><key>ProgramArguments</key><array>${job.args.map(a=>`<string>${esc(a)}</string>`).join('')}</array>
 <key>WorkingDirectory</key><string>${esc(root)}</string><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k,v])=>`<key>${k}</key><string>${esc(v)}</string>`).join('')}</dict>
 <key>RunAtLoad</key><true/>${job.extra}<key>Umask</key><integer>63</integer><key>ThrottleInterval</key><integer>30</integer>
 <key>StandardOutPath</key><string>${esc(join(DEFAULT_DATA,job.label+'.log'))}</string><key>StandardErrorPath</key><string>${esc(join(DEFAULT_DATA,job.label+'.error.log'))}</string>
 </dict></plist>`;
 writeFileSync(path,xml,{mode:0o600});execFileSync('/usr/bin/plutil',['-lint',path],{stdio:'ignore'});
 try{execFileSync('/bin/launchctl',['bootout',`${domain}/${job.label}`],{stdio:'ignore'});}catch{/* Not installed yet. */}
 execFileSync('/bin/launchctl',['bootstrap',domain,path]);
 console.log(`Installed ${job.label}`);
}
const store=new Store(DEFAULT_DATA);new Reviews(store).set('schedule','Daily at 6 a.m. Pacific');store.close();
