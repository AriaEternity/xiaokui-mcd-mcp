import './network-guard.mjs';
import {mcdOrderQuerySummary} from '../dist/mcd/order-status.js';
import {mcdPaymentUrl} from '../dist/mcd/orders.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const summarize=data=>mcdOrderQuerySummary(data,mcdPaymentUrl);
const pickup={pickupCode:'SYNTHETIC-PICKUP-1',lockerCode:'SYNTHETIC-LOCKER-1',lockerQrCode:'https://m.mcd.cn/synthetic-locker'};

test('官方数字字符串/数字与已核实中文状态分别规范化；另一套status原样保留不作映射',()=>{
 for(const [raw,state,name] of [
  ['1','PENDING_PAYMENT','待支付'],['2','PREPARING','餐厅配餐中'],['4','DELIVERING','配送中'],
  ['6','COMPLETED','订单已完成'],['7','CANCELLED','已取消'],['8','REVIEWED','已评价'],['10','RESTAURANT_CONFIRMED','餐厅确认配餐中'],
  [1,'PENDING_PAYMENT','待支付'],[2,'PREPARING','餐厅配餐中'],[6,'COMPLETED','订单已完成'],
  ['待支付','PENDING_PAYMENT','待支付'],['餐厅配餐中','PREPARING','餐厅配餐中'],['订单已完成','COMPLETED','订单已完成'],
 ]){
  const r=summarize({orderStatus:raw,status:'40'});
  assert.equal(r.officialOrderStatus,raw);assert.equal(r.officialStatus,'40');
  assert.equal(r.normalizedOrderStatus,state);assert.equal(r.orderStatusName,name);
  assert.equal(r.paymentStatus,state==='PENDING_PAYMENT'?'pending':'unverified');
  assert.deepEqual(r.paymentVerification,{status:'unverified',source:'not_provided'});
 }
});

test('未知、缺失、异常状态安全兜底；不把status的其他编码或原型属性当成已知状态',()=>{
 for(const raw of ['未公开的新状态','40','未完成','constructor','__proto__','',null,undefined,{},[],true,Infinity,'6\n','x'.repeat(129)]){
  const r=summarize({orderStatus:raw,status:'6',...pickup});
  assert.equal(r.normalizedOrderStatus,'UNKNOWN');assert.equal(r.orderStatusName,'未知状态');
  assert.equal(r.paymentStatus,'unverified');assert.equal(r.pickupInformationStatus,'withheld');
  assert.equal(r.pickupCode,undefined);assert.equal(r.lockerCode,undefined);assert.equal(r.lockerQrCode,undefined);
 }
 assert.equal(summarize({orderStatus:'未公开的新状态'}).officialOrderStatus,'未公开的新状态');
 assert.equal(summarize({orderStatus:{nested:'SYNTHETIC-PRIVATE'}}).officialOrderStatus,null);
});

test('完成/配餐与payId/金额/额外支付字段不构成独立支付证据；数字2仅保留官方已支付提示',()=>{
 for(const raw of ['餐厅配餐中','订单已完成','4','6','8','10']){
  const r=summarize({orderStatus:raw,payId:'SYNTHETIC-PAY-ID',realTotalAmount:'16.00',paymentStatus:'confirmed',paid:true});
  assert.equal(r.paymentStatus,'unverified');assert.equal(r.orderStatusPaymentHint,'not_provided');
  assert.equal(r.paymentVerification.status,'unverified');assert(r.notice.includes('这不代表用户未付款'));
 }
 const r=summarize({orderStatus:'2'});
 assert.equal(r.orderStatusPaymentHint,'paid');assert.equal(r.paymentStatus,'unverified');
 assert.equal(r.pickupInformationStatus,'not_provided');assert.equal(r.pickupCode,undefined);
 assert(r.notice.includes('仅作为订单状态中的支付提示'));
});

test('未返回取餐信息时明确缺失；即使订单状态明确含已支付也不生成取餐码',()=>{
 for(const raw of ['2','订单已完成']){
  const r=summarize({orderStatus:raw,pickupCode:'',lockerCode:null});
  assert.equal(r.pickupInformationStatus,'not_provided');assert.equal(r.pickupCode,undefined);
  assert(r.notice.includes('未提供非空取餐码'));
 }
});

test('待支付、已取消、未知状态有上游取餐字段仍隐藏',()=>{
 for(const raw of ['1','待支付','7','已取消','SYNTHETIC-UNKNOWN']){
  const r=summarize({orderStatus:raw,...pickup});
  assert.equal(r.pickupInformationStatus,'withheld');
  for(const k of Object.keys(pickup))assert.equal(r[k],undefined);
 }
});

test('同一订单已知履约状态允许独立展示校验合格的官方码/柜码/柜二维码，不假称独立支付成功',()=>{
 for(const raw of ['2','4','6','8','10','餐厅配餐中','订单已完成']){
  const r=summarize({orderStatus:raw,...pickup,mobilePhone:'SYNTHETIC-PRIVATE-PHONE',deliveryInfo:{pickupCode:'SYNTHETIC-NESTED'}});
  assert.equal(r.pickupInformationStatus,'available');
  for(const k of Object.keys(pickup))assert.equal(r[k],pickup[k]);
  assert.equal(r.paymentVerification.status,'unverified');
  assert(!JSON.stringify(r).includes('SYNTHETIC-PRIVATE-PHONE'));assert(!JSON.stringify(r).includes('SYNTHETIC-NESTED'));
 }
 assert.equal(summarize({orderStatus:'订单已完成',deliveryInfo:{pickupCode:'SYNTHETIC-NESTED'}}).pickupInformationStatus,'not_provided');
});

test('畸形码、控制字符、超长/脱敏值及非官方/测试/非HTTPS二维码拒绝，仅返回通过校验的字段',()=>{
 for(const value of [123,{},['SYNTHETIC'],true,' ','bad\ncode','<script>','x'.repeat(129),'[REDACTED]']){
  const r=summarize({orderStatus:'2',pickupCode:value});
  assert.equal(r.pickupInformationStatus,'invalid');assert.equal(r.pickupCode,undefined);
 }
 for(const url of ['http://m.mcd.cn/locker','https://attacker.invalid/locker','https://m.mcd.cn.attacker.invalid/locker','https://m-sit.mcdchina.net/locker','https://m.mcd.cn:444/locker','https://user:pass@m.mcd.cn/locker','https://m.mcd.cn/[REDACTED]']){
  const r=summarize({orderStatus:'订单已完成',lockerQrCode:url});
  assert.equal(r.lockerQrCode,undefined);assert.equal(r.pickupInformationStatus,'invalid');
 }
 const r=summarize({orderStatus:'订单已完成',pickupCode:pickup.pickupCode,lockerQrCode:'https://attacker.invalid/locker'});
 assert.equal(r.pickupCode,pickup.pickupCode);assert.equal(r.lockerQrCode,undefined);
});

test('两份报告的履约状态转换序列回归（仅合成订单和取餐码）',()=>{
 for(const [sequence,expected] of [
  [['待支付','餐厅配餐中','餐厅配餐中','订单已完成'],['PENDING_PAYMENT','PREPARING','PREPARING','COMPLETED']],
  [['餐厅配餐中','订单已完成'],['PREPARING','COMPLETED']],
 ]){
  const rows=sequence.map(orderStatus=>summarize({orderStatus,pickupCode:pickup.pickupCode}));
  assert.deepEqual(rows.map(r=>r.normalizedOrderStatus),expected);
  for(let i=0;i<rows.length;i++){
   assert.equal(rows[i].paymentVerification.status,'unverified');
   assert.equal(rows[i].pickupInformationStatus,expected[i]==='PENDING_PAYMENT'?'withheld':'available');
  }
 }
});
