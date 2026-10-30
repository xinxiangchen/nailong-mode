import assert from 'node:assert/strict';
import { faceCrop, restoreFaceCoordinates } from '../js/face-tracking.js';

const pose = (x = 0.5, y = 0.3) => ({ landmarks: [Array.from({length:33}, (_,i) => ({
  x: x + (i % 3 - 1) * 0.025, y: y + (i % 4 - 1.5) * 0.012, visibility: 1,
}))] });
for (const [width,height] of [[1280,720],[1920,1080],[720,1280]]) {
  for (const x of [0.04,0.5,0.96]) {
    const crop = faceCrop(pose(x),width,height);
    assert.ok(crop && crop.size >= 96);
    assert.ok(crop.x >= 0 && crop.x+crop.size <= width);
    assert.ok(crop.y >= 0 && crop.y+crop.size <= height);
    const point = {x:0.35,y:0.4,z:-0.12};
    const local = {x:(point.x*width-crop.x)/crop.size,y:(point.y*height-crop.y)/crop.size,z:point.z*width/crop.size};
    const blends = [{categories:[{categoryName:'jawOpen',score:0.7}]}];
    const restored = restoreFaceCoordinates({faceLandmarks:[[local]],faceBlendshapes:blends,facialTransformationMatrixes:[{}]},crop,width,height);
    for (const k of ['x','y','z']) assert.ok(Math.abs(restored.faceLandmarks[0][0][k]-point[k])<1e-12);
    assert.equal(restored.faceBlendshapes,blends);
    assert.deepEqual(restored.facialTransformationMatrixes,[]);
  }
}
assert.equal(faceCrop(null,1280,720),null);
const hidden=pose();hidden.landmarks[0].forEach(p=>p.visibility=0.1);
assert.equal(faceCrop(hidden,1280,720),null);
const tiny=pose();tiny.landmarks[0].forEach(p=>p.x=0.5);
assert.equal(faceCrop(tiny,1280,720),null);
const close=pose();close.landmarks[0].forEach((p,i)=>p.x=i%2?0.1:0.9);
assert.equal(faceCrop(close,1280,720),null);
const absent={faceLandmarks:[],faceBlendshapes:[]};
assert.deepEqual(restoreFaceCoordinates(absent,{x:0,y:0,size:100},1280,720).faceLandmarks,[]);
assert.equal(restoreFaceCoordinates(absent,null,1280,720),absent);
console.log('face crop bounds, depth/coordinate restoration, missing-face handling passed');
