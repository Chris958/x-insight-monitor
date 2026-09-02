import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import { DataStore } from './store.js';
import { MonitorEngine } from './engine.js';

let win: BrowserWindow | null=null, tray: Tray | null=null, quitting=false, shutdownStarted=false, settingsRequireRestart=false, store:DataStore, engine:MonitorEngine;
const notify=()=>win?.webContents.send('state:changed');

function createWindow(){
  win=new BrowserWindow({width:1240,height:820,minWidth:980,minHeight:680,show:false,backgroundColor:'#f4f7fb',title:'X Insight Monitor',webPreferences:{preload:join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const dev=process.env.VITE_DEV_SERVER_URL; if(dev)void win.loadURL(dev); else void win.loadFile(join(__dirname,'../renderer/index.html'));
  win.once('ready-to-show',()=>{if(!store.getSettings().launchMinimized)win?.show();});
  win.on('close',e=>{if(!quitting){e.preventDefault();win?.hide();}});
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void import('electron').then(({shell})=>shell.openExternal(url));return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file:')&&!url.startsWith(process.env.VITE_DEV_SERVER_URL||'file:')){event.preventDefault();if(/^https:\/\//.test(url))void import('electron').then(({shell})=>shell.openExternal(url));}});
}

function createTray(){
  tray=new Tray(nativeImage.createEmpty()); tray.setToolTip('X Insight Monitor');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开',click:()=>win?.show()},{label:'启动监控',click:()=>void engine.start().catch(()=>undefined)},{label:'停止监控',click:()=>void engine.stop()},{type:'separator'},{label:'退出',click:()=>{quitting=true;app.quit();}}])); tray.on('double-click',()=>win?.show());
}

function registerIpc(){
  ipcMain.handle('state:get',async()=>{const snap=store.snapshot(),secrets=await store.getSecrets();return{data:snap,status:engine.getStatus(),secretFlags:{openaiApiKey:!!secrets.openaiApiKey,wecomWebhookUrl:!!secrets.wecomWebhookUrl,xOfficialBearerToken:!!secrets.xOfficialBearerToken,xCookieHeader:!!secrets.xCookieHeader},secrets:{...secrets,openaiApiKey:'',wecomWebhookUrl:'',xOfficialBearerToken:'',xCookieHeader:''}}});
  ipcMain.handle('settings:save',async(_e,value)=>{const before=store.getSettings();await store.saveSettings(value);const s=store.getSettings();app.setLoginItemSettings({openAtLogin:s.autoStart,openAsHidden:s.launchMinimized});settingsRequireRestart=settingsRequireRestart||before.realtimeWebhookEnabled!==s.realtimeWebhookEnabled||before.groupDailySummaryEnabled!==s.groupDailySummaryEnabled||before.dailySummaryTime!==s.dailySummaryTime;notify();});
  ipcMain.handle('secrets:save',async(_e,value)=>{
    const current=await store.getSecrets(),input=value as Record<string,unknown>,patch:Record<string,string>={};
    for(const key of ['openaiApiKey','wecomWebhookUrl','xOfficialBearerToken','xCookieHeader','xAccountAlias']) if(typeof input[key]==='string') patch[key]=input[key] as string;
    for(const key of ['openaiApiKey','wecomWebhookUrl','xOfficialBearerToken','xCookieHeader']) if(!patch[key]) patch[key]=(current as any)[key];
    if(input.clearXOfficialBearerToken===true) patch.xOfficialBearerToken='';
    const next={...current,...patch};
    const sourceChanged=next.xOfficialBearerToken!==current.xOfficialBearerToken||next.xCookieHeader!==current.xCookieHeader||next.xAccountAlias!==current.xAccountAlias;
    const pushChanged=next.wecomWebhookUrl!==current.wecomWebhookUrl;
    const wasRunning=engine.getStatus().running;
    await store.saveSecrets(next);
    if(wasRunning&&(sourceChanged||pushChanged||settingsRequireRestart)){await engine.stop();await engine.start();}
    settingsRequireRestart=false;
    notify();
  });
  ipcMain.handle('accounts:add',async(_e,v)=>{const r=await store.addAccount(v);notify();return r;}); ipcMain.handle('accounts:update',async(_e,id,v)=>{const r=await store.updateAccount(id,v);notify();return r;}); ipcMain.handle('accounts:delete',async(_e,id)=>{await store.deleteAccount(id);notify();}); ipcMain.handle('accounts:poll',async(_e,id)=>engine.pollNow(id));
  ipcMain.handle('engine:start',async()=>{await engine.start();notify();}); ipcMain.handle('engine:stop',async()=>{await engine.stop();notify();});
  ipcMain.handle('test:model',()=>engine.testModel()); ipcMain.handle('test:wecom-webhook',()=>engine.testWeComWebhook()); ipcMain.handle('test:collector',()=>engine.testCollector());
}

app.whenReady().then(async()=>{store=new DataStore();await store.init();engine=new MonitorEngine(store,notify);registerIpc();createWindow();createTray();if(store.getSettings().autoStart)engine.start().catch(e=>store.log('error','startup',e.message));});
app.on('before-quit',event=>{quitting=true;if(!shutdownStarted&&engine){event.preventDefault();shutdownStarted=true;void engine.stop().finally(()=>app.quit());}}); app.on('activate',()=>{if(!win)createWindow();else win.show();});
