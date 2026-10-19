const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const fs = require('node:fs');

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'chitrakatha-security-tests',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') }
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'owner-1'), {
      displayName: 'Synthetic Test Owner',
      role: 'superAdmin',
      accountStatus: 'approved'
    });
    await setDoc(doc(db, 'users', 'admin-1'), {
  displayName: 'Synthetic Test Admin',
  role: 'admin',
  accountStatus: 'approved'
});

await setDoc(doc(db, 'users', 'deployer-1'), {
  displayName: 'Synthetic Test Deployer',
  role: 'deployer',
  accountStatus: 'approved'
});

await setDoc(doc(db, 'users', 'freelancer-1'), {
  displayName: 'Synthetic Test Freelancer',
  role: 'freelancer',
  accountStatus: 'approved'
});

await setDoc(doc(db, 'users', 'pending-1'), {
  displayName: 'Synthetic Pending User',
  role: 'freelancer',
  accountStatus: 'pending'
});
    await setDoc(doc(db, 'financialRecords', 'payment-1'), {
      ownerUid: 'owner-1', amount: 5000
    });
    await setDoc(doc(db, 'deployments', 'job-1'), {
      client: 'Synthetic test only'
    });
  });
});

test('a user can read their own profile', async () => {
  const db = env.authenticatedContext('owner-1').firestore();
  await assertSucceeds(getDoc(doc(db, 'users', 'owner-1')));
});

test('a user cannot read another profile', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();
  await assertFails(getDoc(doc(db, 'users', 'owner-1')));
});

test('a client cannot create a profile granting itself superAdmin', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();
  await assertFails(setDoc(doc(db, 'users', 'freelancer-1'), {
    displayName: 'Synthetic Test',
    role: 'superAdmin',
    accountStatus: 'approved'
  }));
});

test('a client cannot change role or approval status', async () => {
  const db = env.authenticatedContext('owner-1').firestore();
  await assertFails(updateDoc(doc(db, 'users', 'owner-1'), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users', 'owner-1'), {
    accountStatus: 'approved'
  }));
});

test('Super Admin cannot read financial records', async () => {
  const db = env.authenticatedContext('owner-1').firestore();
  await assertFails(getDoc(doc(db, 'financialRecords', 'payment-1')));
});

test('operational records remain denied until their permissions are implemented', async () => {
  const db = env.authenticatedContext('owner-1').firestore();
  await assertFails(getDoc(doc(db, 'deployments', 'job-1')));
});

test('unauthenticated clients cannot read profiles or financial records', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'users', 'owner-1')));
  await assertFails(getDoc(doc(db, 'financialRecords', 'payment-1')));
});
