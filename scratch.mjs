import crypto from 'crypto';
const salt = 'GLITgdmQ6clEQGoTm4Mku1ZmAXdjgIQo';
const status = 'success';
const udf1 = '';
const udf2 = '';
const udf3 = '';
const udf4 = '';
const udf5 = '';
const email = 'divyansh@example.com';
const firstname = 'Arjun';
const productinfo = 'Wireless Headphones  Black ';
const amount = '4999.00';
const txnid = 'txid_71c9bbdec9532fdfa949f51b';
const key = 'T5c7MB';

const baseNoSplit = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
console.log('String:', baseNoSplit);
console.log('Hash:', crypto.createHash('sha512').update(baseNoSplit).digest('hex'));
