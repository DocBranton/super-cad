import test from "node:test";
import assert from "node:assert/strict";
import { changeImpact } from "../shared/change-impact.js";
const model = {parameters:[{name:"width",expr:20},{name:"half_width",expr:"width / 2"},{name:"depth",expr:5}],bodies:[{id:"a",name:"Mount",placement:[0,0,0],features:[{id:"f1",op:"extrude",distance:"half_width"},{id:"f2",op:"hole",diameter:"depth"}]}]};
test("change propagates through named parameters and downstream features",()=>{
 const after=structuredClone(model);after.parameters[0].expr=30;
 const r=changeImpact(model,after);
 assert.deepEqual(r.changedParameters,["width"]);
 assert.deepEqual(r.derivedParameters,["half_width"]);
 assert.equal(r.affected.length,2);
 assert.equal(r.affected[0].direct,true);
 assert.equal(r.affected[1].direct,false);
 assert.equal(r.requiresValidation,true);
});
test("unchanged model has no impact",()=>{
 const r=changeImpact(model,structuredClone(model));
 assert.equal(r.affected.length,0);assert.equal(r.requiresValidation,false);
});
test("added body is impacted",()=>{
 const after=structuredClone(model);after.bodies.push({id:"b",name:"New",placement:[0,0,0],features:[{id:"f3",op:"extrude",distance:5}]});
 const r=changeImpact(model,after);assert.equal(r.affected.length,1);assert.equal(r.affected[0].direct,true);
});
