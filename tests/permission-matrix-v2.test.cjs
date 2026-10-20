
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const PROJECT_ID = 'chitrakatha-permission-v2-test';
const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = '8081';

let testEnv;

test('connect to the isolated permission-matrix-v2 emulator', async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: Number(EMULATOR_PORT),
    },
  });

  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users/super-1'), {
      roles: ['superAdmin'],
      status: 'approved',
    });

    await setDoc(doc(db, 'users/deployer-1'), {
      roles: ['deployer'],
      status: 'approved',
    });

    await setDoc(doc(db, 'users/freelancer-1'), {
      roles: ['freelancer'],
      status: 'approved',
    });

    await setDoc(doc(db, 'users/pending-1'), {
      roles: [],
      status: 'pending',
    });

    await setDoc(doc(db, 'finance/deployment-1'), {
      ownerUid: 'deployer-1',
      clientAmount: 50000,
    });

    await setDoc(doc(db, 'finance/payment-1'), {
      freelancerUid: 'freelancer-1',
      deploymentId: 'deployment-1',
      amount: 5000,
    });
  });

  assert.ok(testEnv, 'Test environment initialized');
});

test('candidate rules deny unauthenticated reads', async () => {
  const db = testEnv.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(db, 'users/super-1')));
  await assertFails(getDoc(doc(db, 'finance/deployment-1')));
});

test('candidate rules deny client-side role changes', async () => {
  const db = testEnv.authenticatedContext('deployer-1').firestore();

  await assertFails(setDoc(doc(db, 'users/deployer-1'), {
    roles: ['superAdmin'],
    status: 'approved',
  }));
});

test('candidate rules deny all finance reads for every role', async () => {
  for (const uid of [
    'super-1',
    'deployer-1',
    'freelancer-1',
    'pending-1',
  ]) {
    const db = testEnv.authenticatedContext(uid).firestore();

    await assertFails(getDoc(doc(db, 'finance/deployment-1')));
    await assertFails(getDoc(doc(db, 'finance/payment-1')));
  }
});

test('candidate rules deny all operational reads until explicitly implemented', async () => {
  const db = testEnv.authenticatedContext('deployer-1').firestore();

  await assertFails(getDoc(doc(db, 'events/event-1')));
});

test('cleanup isolated test environment', async () => {
  if (testEnv) {
    await testEnv.cleanup();
    testEnv = undefined;
  }
});
