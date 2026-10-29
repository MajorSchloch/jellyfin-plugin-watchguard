// Jellyfin's native dialog close event follows exit animation and its history
// notification. A completed button click (or hidden text) alone can precede it.
module.exports = async function dismissNativeError(page, errorText) {
    const error = page.getByText(errorText, {exact:true});
    await error.waitFor({state:'visible'});
    const state = await error.evaluateHandle(element => {
        const dialog = element.closest('.dialog');
        if (!dialog) throw new Error('Expected the native Jellyfin error dialog');
        const state = {closed:false, closedAt:null};
        dialog.addEventListener('close', () => {
            state.closedAt = performance.now();
            state.closed = true;
        }, {once:true});
        return state;
    });
    try {
        await page.getByRole('button', {name:'Got It', exact:true}).click();
        const clicked = await state.evaluate(state => ({
            clickReturnedAt:performance.now(), closedWhenClickReturned:state.closed
        }));
        await page.waitForFunction(state => state.closed, state);
        await error.waitFor({state:'hidden'});
        return {...clicked, ...await state.evaluate(state => ({closedAt:state.closedAt}))};
    } finally {
        await state.dispose();
    }
};
