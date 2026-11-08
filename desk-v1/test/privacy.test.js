'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { maskPii, applyPrivacy, maskPhone } = require('../src/main/privacy');

test('D-12 默认关闭时原文返回，不做任何打码', () => {
  const raw = '买家 13812345678 邮箱 buyer@example.com';
  assert.equal(applyPrivacy(raw, { maskPii: false }), raw);
  assert.equal(applyPrivacy(raw), raw);
});

test('开启后掩码手机号、邮箱与身份证号', () => {
  const masked = maskPii('电话 13812345678 邮箱 buyer@example.com 证件 11010119900307123X');
  assert.equal(masked.includes('13812345678'), false);
  assert.match(masked, /138\*{4}5678/);
  assert.equal(masked.includes('buyer@example.com'), false);
  assert.match(masked, /b\*\*\*@example\.com/);
  assert.equal(masked.includes('11010119900307123X'), false);
  assert.match(masked, /110101\*{8}123X/);
});

test('非手机号的一串数字不被误伤', () => {
  assert.equal(maskPii('订单号 123456789012345'), '订单号 123456789012345');
});

test('maskPhone 保留前三后四', () => {
  assert.equal(maskPhone('13812345678'), '138****5678');
});

test('applyPrivacy 开启等价于 maskPii', () => {
  assert.equal(applyPrivacy('13812345678', { maskPii: true }), '138****5678');
});
