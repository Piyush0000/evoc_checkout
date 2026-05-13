import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { PayUGateway } from '../services/payment.service.js';

describe('PayUGateway', () => {
  it('should generate a correct hash according to the PayU formula', async () => {
    const key = 'test_key';
    const salt = 'test_salt';
    process.env.TEST_PAYU_KEY = key;
    process.env.TEST_PAYU_SALT = salt;

    const gateway = new PayUGateway();
    const customer = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '9999999999',
    };
    const productInfo = 'iPhone';
    const amount = 100.00;

    const intent = await gateway.createIntent(amount, 'INR', customer, productInfo);

    const txnid = intent.id;
    const amountStr = '100.00';
    const udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = '';
    
    // Formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
    const expectedHashString = `${key}|${txnid}|${amountStr}|${productInfo}|${customer.firstName}|${customer.email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
    const expectedHash = crypto.createHash('sha512').update(expectedHashString).digest('hex');

    expect(intent.clientSecret).toBe(expectedHash);
    expect(intent.additionalParams?.hash).toBe(expectedHash);
  });

  it('should verify the reverse hash from a PayU response', () => {
    const key = 'test_key';
    const salt = 'test_salt';
    process.env.TEST_PAYU_KEY = key;
    process.env.TEST_PAYU_SALT = salt;

    const gateway = new PayUGateway();
    const payload = {
      status: 'success',
      txnid: 'txid_123',
      amount: '1000.00',
      productinfo: 'iPhone',
      firstname: 'John',
      email: 'john@example.com',
      key: key,
      udf1: '',
      udf2: '',
      udf3: '',
      udf4: '',
      udf5: '',
      mihpayid: '4039937155',
    };

    // sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
    const reverseHashString = `${salt}|${payload.status}||||||${payload.udf5}|${payload.udf4}|${payload.udf3}|${payload.udf2}|${payload.udf1}|${payload.email}|${payload.firstname}|${payload.productinfo}|${payload.amount}|${payload.txnid}|${payload.key}`;
    const hash = crypto.createHash('sha512').update(reverseHashString).digest('hex');
    
    expect(gateway.verifyResponseHash({ ...payload, hash })).toBe(true);
    expect(gateway.verifyResponseHash({ ...payload, hash: 'wrong_hash' })).toBe(false);
  });

  it('should verify reverse hash when additional_charges is present', () => {
    const key = 'test_key';
    const salt = 'test_salt';
    process.env.TEST_PAYU_KEY = key;
    process.env.TEST_PAYU_SALT = salt;

    const gateway = new PayUGateway();
    const payload = {
      status: 'success',
      txnid: 'txid_123',
      amount: '1000.00',
      productinfo: 'iPhone',
      firstname: 'John',
      email: 'john@example.com',
      key,
      udf1: '',
      udf2: '',
      udf3: '',
      udf4: '',
      udf5: '',
      additional_charges: '12.34',
    };

    const reverseHashString = `${payload.additional_charges}|${salt}|${payload.status}||||||${payload.udf5}|${payload.udf4}|${payload.udf3}|${payload.udf2}|${payload.udf1}|${payload.email}|${payload.firstname}|${payload.productinfo}|${payload.amount}|${payload.txnid}|${payload.key}`;
    const hash = crypto.createHash('sha512').update(reverseHashString).digest('hex');
    expect(gateway.verifyResponseHash({ ...payload, hash })).toBe(true);
  });
});
