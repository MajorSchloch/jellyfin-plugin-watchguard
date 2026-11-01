// This exception describes one observed UI defect in one immutable package.
// Every membership, request-count, retry and protection assertion stays external and strict.
const assert=require('node:assert/strict');
const published=require('./published-v031-identity.json');
function validateIdentity(identity, standalone, candidateVersion, liveVersion) {
    assert(identity,'Missing deployed package identity');
    const expected=standalone ? candidateVersion : published.version;
    assert.equal(identity.version,expected,'Unexpected fixture version');
    assert.equal(identity.activeVersion,expected+'.0','Unexpected active plugin');
    assert.equal(identity.reportedVersion,expected,'Unexpected reported plugin');
    assert.equal(liveVersion,expected,'Plugin changed since deployment verification');
    assert.match(identity.packageSha256,/^[0-9a-f]{64}$/);
    assert.match(identity.dllSha256,/^[0-9a-f]{64}$/);
    assert.equal(identity.deployedDllSha256,identity.dllSha256,'Deployed DLL identity mismatch');
    if(!standalone){
        assert.equal(identity.packageSha256,published.packageSha256,'Unknown historical ZIP');
        assert.equal(identity.dllSha256,published.dllSha256,'Unknown historical DLL');
    }
}
function classify(identity, standalone, candidateVersion, liveVersion, alert) {
    validateIdentity(identity,standalone,candidateVersion,liveVersion);
    if(alert.includes('Could not remove'))return {status:'PASS',check:'removal-feedback-after-activity'};
    assert.equal(alert,'','Only the exact empty-error defect is a historical limitation');
    assert.equal(standalone,false,'Candidate activity completion must retain removal feedback');
    assert.equal(identity.version,published.version);
    return {status:'KNOWN_LIMITATION',check:'removal-feedback-after-activity',
        limitation:'Published v0.3.1 erases removal feedback when activity completes',identity};
}
module.exports={validateIdentity,classify};
