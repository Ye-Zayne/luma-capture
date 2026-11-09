const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { filters, encode, run } = require('../src/encoder.cjs');

test('crop rejects out-of-bounds and non-finite coordinates', () => {
  for(const crop of [{x:-1,y:0,width:.2,height:.2},{x:.9,y:0,width:.2,height:1},{x:NaN,y:0,width:1,height:1}])assert.throws(()=>filters({crop}),/无效/);
});
test('GIF conversion preserves cropped dimensions and loop metadata', async () => {
  const binary=require('ffmpeg-static');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-test-'));
  try {
    const input=path.join(dir,'input.webm'),output=path.join(dir,'output.gif');
    await run(binary,['-f','lavfi','-i','testsrc2=size=640x360:rate=20:duration=1','-c:v','libvpx-vp9',input]);
    const progress=[];
    const result=await encode({binary,input,output,options:{preset:'balanced',crop:{x:.25,y:0,width:.5,height:1}},onProgress:p=>progress.push(p.percent)});
    const bytes=await fs.readFile(output);
    assert.equal(bytes.subarray(0,6).toString(),'GIF89a');
    assert.equal(bytes.readUInt16LE(6),320);
    assert.equal(bytes.readUInt16LE(8),360);
    assert.ok(bytes.includes(Buffer.from('NETSCAPE2.0')));
    assert.equal(result.size,bytes.length);
    assert.equal(progress.at(-1),100);
    assert.equal(result.targetMet,true);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('failed conversion rejects and removes intermediate palette',async()=>{
  const binary=require('ffmpeg-static');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luma-test-'));
  try {
    await assert.rejects(encode({binary,input:path.join(dir,'missing.webm'),output:path.join(dir,'out.gif')}));
    await assert.rejects(fs.stat(path.join(dir,'palette.png')));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
