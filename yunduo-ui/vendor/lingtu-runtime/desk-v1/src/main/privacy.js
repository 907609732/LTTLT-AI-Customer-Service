'use strict';
/**
 * D-12：日志/诊断/存档默认保留原文（privacy.maskPii=false）。
 * 打码实现必须保留，供用户显式开启；不得把开关写成死常量。
 */
const PHONE_RE = /(?<!\d)(1[3-9]\d{9})(?!\d)/g;
const ID_CARD_RE = /(?<!\d)(\d{6})\d{8}(\d{3}[\dXx])(?!\d)/g;
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function maskPhone(phone) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function maskPii(value) {
  return String(value == null ? '' : value)
    .replace(ID_CARD_RE, (_match, head, tail) => `${head}********${tail}`)
    .replace(PHONE_RE, (phone) => maskPhone(phone))
    .replace(EMAIL_RE, (_match, first, domain) => `${first}***${domain}`);
}

/** 开关关闭时原样返回，保证默认行为不引入任何额外处理。 */
function applyPrivacy(value, { maskPii: enabled = false } = {}) {
  return enabled ? maskPii(value) : value;
}

module.exports = { maskPii, applyPrivacy, maskPhone };

