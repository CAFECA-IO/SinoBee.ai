import { test } from "node:test";
import assert from "node:assert/strict";
import { cardBrand } from "../src/lib/card-brand";

test("card network from the gateway's name or the first digits of a masked number", () => {
  assert.equal(cardBrand("424242******4242"), "visa");
  assert.equal(cardBrand("5555 55** **** 4444"), "mastercard");
  assert.equal(cardBrand("222300******0010"), "mastercard");
  assert.equal(cardBrand("3566********0505"), "jcb");
  assert.equal(cardBrand("3782*******0005"), "amex");
  assert.equal(cardBrand("6212********0018"), "unionpay");
  assert.equal(cardBrand(undefined, "MasterCard"), "mastercard");
  assert.equal(cardBrand("VISA ****1234"), "visa");
  assert.equal(cardBrand("銀聯卡"), "unionpay");
  // only the last four digits: unknown, not "visa" for 4242
  assert.equal(cardBrand("4242"), null);
  assert.equal(cardBrand("****4242"), null);
  assert.equal(cardBrand(null, 42, ""), null);
});
