/* Native Jellyfin pages only: no route interception, response mocks or injected listing UI. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixture=JSON.parse(fs.readFileSync(process.argv[2]));
const content=JSON.parse(fs.readFileSync(path.join(__dirname,'../catalog/content.json')));
const output=path.join(fixture.reportDirectory,'catalog-listing');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const width of [1280,390]){
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,ignoreHTTPSErrors:!!fixture.tls,reducedMotion:'reduce'});
   const page=await context.newPage();page.setDefaultTimeout(15000);
   try{
    await readiness.login(page,fixture);
    await page.goto(fixture.base+'/web/#/dashboard/plugins');
    await page.getByText('WatchGuard',{exact:true}).first().waitFor({timeout:30000});
    await page.getByRole('button',{name:'All',exact:true}).first().click();
    await page.getByRole('textbox',{name:'Search',exact:true}).fill('WatchGuard');
    const card=page.locator('a[href*="/dashboard/plugins/"][href*="name=WatchGuard"]');
    await card.waitFor();
    const cardImage=card.locator('[title="WatchGuard"]');
    const cardData=await cardImage.evaluate(async el=>{const url=getComputedStyle(el).backgroundImage.slice(5,-2);const img=new Image();img.src=url;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight,url};});
    assert.equal(cardData.width,1672);assert.equal(cardData.height,941);
    await page.screenshot({path:path.join(output,'catalog-'+width+'.png'),fullPage:false,animations:'disabled'});
    await card.click();
    await page.locator('#addPluginPage').waitFor();
    await page.getByText(content.description,{exact:true}).waitFor();
    const table=page.locator('#addPluginPage table');
    await table.getByText('0.7.7.0',{exact:true}).waitFor();
    assert.ok((await table.innerText()).includes('Active'));
    const repo=table.getByRole('link',{name:'WatchGuard listing fixture'});
    assert.equal(await repo.getAttribute('href'),fixture.repositoryUrl);
    const img=page.locator('#addPluginPage img[alt="WatchGuard"]');
    await img.evaluate(image=>image.decode());
    const image=await img.evaluate(el=>({url:el.src,width:el.naturalWidth,height:el.naturalHeight,visible:!!el.getClientRects().length}));
    assert.match(image.url,/\/Plugins\/[^/]+\/0\.7\.7\.0\/Image/);
    assert.equal(image.width,1672);assert.equal(image.height,941);
    assert.equal(image.visible,width>=1200,'Keep native responsive details-image behavior');
    const response=await context.request.get(image.url);
    assert.equal(response.status(),200);
    assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),fixture.imageSha256);
    const versions=Object.keys(content.versions).reverse();
    for(const version of versions){
     const revision=page.getByRole('button',{name:new RegExp('^'+version.replaceAll('.','\\.')+'\\s')});
     await revision.click();
     const bullet=page.getByText(content.versions[version].summary[0],{exact:true});
     await bullet.waitFor();assert.equal(await bullet.isVisible(),true);
     const region=page.locator('.MuiAccordion-root').filter({has:revision});
     assert.equal(await region.getByRole('link',{name:'Details',exact:true}).getAttribute('href'),content.versions[version].documentation);
     if(version==='0.7.7.0')assert.equal(await region.getByRole('button',{name:'Installed',exact:true}).isDisabled(),true);
     await revision.click();
    }
    for(const version of ['0.7.7.0','0.7.6.0','0.7.5.0'])await page.getByRole('button',{name:new RegExp('^'+version.replaceAll('.','\\.')+'\\s')}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
    assert.equal(await page.getByText('See the matching release notes.',{exact:true}).count(),0);
    await page.screenshot({path:path.join(output,'details-'+width+'.png'),fullPage:false,animations:'disabled'});
    await page.getByRole('heading',{name:'Revision History',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'history-'+width+'.png'),fullPage:false,animations:'disabled'});
    // Installed-only tab retains a genuine native card/image and details navigation.
    await page.goto(fixture.base+'/web/#/dashboard/plugins');
    const installed=page.getByRole('button',{name:'Installed',exact:true});
    await installed.click();
    await page.getByRole('textbox',{name:'Search',exact:true}).fill('WatchGuard');
    const installedCard=page.locator('a[href*="/dashboard/plugins/"][href*="name=WatchGuard"]');
    await installedCard.locator('[title="WatchGuard"]').evaluate(async el=>{const img=new Image();img.src=getComputedStyle(el).backgroundImage.slice(5,-2);await img.decode();});
    await page.screenshot({path:path.join(output,'installed-'+width+'.png'),fullPage:false,animations:'disabled'});
    await installedCard.click();await page.getByText(content.description,{exact:true}).waitFor();
    results.push({width,serverVersion:fixture.serverVersion,webVersion:await page.evaluate(()=>ApiClient.appVersion()),description:true,revisions:versions.length,repositoryLink:true,installedVersion:'0.7.7.0',image,cardImage:true,installedCardImage:true});
   }catch(error){await page.screenshot({path:path.join(output,'failure-'+width+'.png'),fullPage:false,animations:'disabled'}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.txt'),String(error));throw error;}
   finally{await context.close();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'PASS',hostImage:fixture.image,imageSha256:fixture.imageSha256,cases:results},null,2)+'\n');
  console.log('Native plugin listing passed: '+results.length+' layouts, 25 expanded revisions each.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
