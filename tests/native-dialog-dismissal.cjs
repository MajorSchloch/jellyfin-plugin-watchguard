// Jellyfin's native dialog close event follows exit animation and its history
// notification. A completed button click (or hidden text) alone can precede it.
async function dismissNativeDialog(page, content, action) {
    await content.waitFor({state:'visible'});
    const state = await content.evaluateHandle(element => {
        const dialog = element.closest('.dialog');
        if (!dialog) throw new Error('Expected a native Jellyfin dialog');
        const state = {closed:false, closedAt:null};
        dialog.addEventListener('close', () => {
            state.closedAt = performance.now();
            state.closed = true;
        }, {once:true});
        return state;
    });
    try {
        await action();
        const clicked = await state.evaluate(state => ({
            clickReturnedAt:performance.now(), closedWhenClickReturned:state.closed
        }));
        await page.waitForFunction(state => state.closed, state);
        await content.waitFor({state:'hidden'});
        return {...clicked, ...await state.evaluate(state => ({closedAt:state.closedAt}))};
    } finally {
        await state.dispose();
    }
}
module.exports = async function dismissNativeError(page, errorText) {
    return dismissNativeDialog(page, page.getByText(errorText, {exact:true}),
        () => page.getByRole('button', {name:'Got It', exact:true}).click());
};
module.exports.dismissDialog = dismissNativeDialog;
