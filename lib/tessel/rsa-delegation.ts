import NodeRSA from 'node-rsa';

function MockRSA() {}

MockRSA.prototype.exportKey = function () {};

export default global.IS_TEST_ENV ? MockRSA : NodeRSA;
