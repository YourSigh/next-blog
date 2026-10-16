import test from 'node:test';import assert from 'node:assert/strict';
import {createCampTransport} from '../../src/lib/arena/camp/camp-transport.mjs';
test('battle detail transport requires opt-in, an own role, and an exact tuple returned by the latest page',async()=>{
 const auth={userId:'123456',token:'fictional-token',userKey:'fixture-user-key'},calls=[];
 const network=async(url,init)=>{const p=new URL(url).pathname;calls.push(p);if(p==='/game/koh/profile')return Response.json({returnCode:0,data:{roleList:[{roleId:'1000'}]}});if(p==='/game/morebattlelist')return Response.json({returnCode:0,data:{list:[{gameSeq:'game-1',gameSvrId:'server',relaySvrId:'relay',battleType:1}]}});return Response.json({returnCode:0,data:{blueRoles:[],redRoles:[]}});};
 const detail={recommendPrivacy:0,battleType:1,gameSvr:'server',relaySvr:'relay',targetRoleId:'1000',gameSeq:'game-1'};
 const post=(request,path,body)=>request('https://kohcamp.qq.com'+path,{method:'POST',body:JSON.stringify(body),auth});
 const req=createCampTransport({network,auth,battleDetails:true});await assert.rejects(post(req,'/game/battledetail',detail),/本人最新战绩页/);assert.equal(calls.length,0);
 await post(req,'/game/koh/profile',{targetUserId:auth.userId,targetRoleId:'0',resVersion:'3',recommendPrivacy:'0',apiVersion:'2'});
 await post(req,'/game/morebattlelist',{lastTime:0,recommendPrivacy:0,apiVersion:5,friendUserId:auth.userId,option:0});
 for(const body of [{...detail,gameSeq:'not-in-my-page'},{...detail,targetRoleId:'other-person'},{...detail,token:'extra'}])await assert.rejects(post(req,'/game/battledetail',body),/本人最新战绩页/);
 await post(req,'/game/battledetail',detail);assert.equal(calls.filter(p=>p==='/game/battledetail').length,1);
 const basic=createCampTransport({network,auth});await assert.rejects(post(basic,'/game/battledetail',detail),/指定的营地/);
});
