const assert=require('node:assert/strict');
// emby-checkbox intentionally hides its real input. Users click/tap the visible
// label; keyboard tests focus the input and press Space. Never force a click
// through the native caption/outline or change checked state with script.
module.exports=async (checkbox,checked)=>{
    if(await checkbox.isChecked()!==checked){
        assert.ok(await checkbox.evaluate(e=>e.type==='checkbox'&&e.parentElement.tagName==='LABEL'));
        const label=checkbox.locator('..');
        if(await checkbox.evaluate(()=>matchMedia('(pointer:coarse)').matches))await label.tap();
        else await label.click();
    }
    assert.equal(await checkbox.isChecked(),checked,'Native label changes the real checkbox');
};
