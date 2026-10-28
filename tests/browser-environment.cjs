/* Verify the real executable, locked package and failure-diagnostic dependency. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('./browser/node_modules/playwright');
(async()=>{
 assert.equal(process.version,'v24.22.0');
 assert.equal(require('./browser/node_modules/playwright/package.json').version,'1.56.1');
 const expected=require('./browser/node_modules/playwright-core/browsers.json').browsers.find(b=>b.name==='chromium');
 assert.equal(execFileSync('python3',['-c','import zipfile,json; print("diagnostics-ready")'],{encoding:'utf8'}).trim(),'diagnostics-ready');
 const browser=await chromium.launch({headless:true});
 try {
  assert.equal(browser.version(),expected.browserVersion);
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto('data:text/html,<title>Disposable browser check</title>');
  assert.equal(await page.title(),'Disposable browser check');
  fs.mkdirSync('artifacts/testing',{recursive:true});
  fs.writeFileSync('artifacts/testing/browser-environment.json',JSON.stringify({node:process.version,playwright:'1.56.1',chromium:browser.version(),revision:expected.revision,diagnosticsPython:true,result:'PASS'},null,2)+'\n');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
