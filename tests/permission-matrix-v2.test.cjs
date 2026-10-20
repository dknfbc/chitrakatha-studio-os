
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'chitrakatha-permission-v2-test';
let env;

function dbAs(uid, activeMode, accountStatus = 'approved') {
  const rolesByUser = {
    'person-1': ['superAdmin', 'deployer', 'freelancer'],
    'deployer-1': ['deployer'],
    'freelancer-1': ['freelancer'],
    'pending-1': [],
  };

  return env.authenticatedContext(uid, {
    activeMode,
    accountStatus,
    roles: rolesByUser[uid] || [],
  }).firestore();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8081,
    },
  });

  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users/person-1'), {
      approved: true,
      roles: ['superAdmin', 'deployer', 'freelancer'],
    });

    await setDoc(doc(db, 'users/deployer-1'), {
      approved: true,
      roles: ['deployer'],
    });

    await setDoc(doc(db, 'users/freelancer-1'), {
      approved: true,
      roles: ['freelancer'],
    });

    await setDoc(doc(db, 'users/pending-1'), {
      approved: false,
      roles: [],
    });

    await setDoc(doc(db, 'deployments/job-1'), {
      ownerUid: 'person-1',
      assignedFreelancerUids: ['person-1', 'freelancer-1'],
    });

    await setDoc(doc(db, 'deployments/job-2'), {
      ownerUid: 'deployer-1',
      assignedFreelancerUids: ['freelancer-1'],
    });

    await setDoc(doc(db, 'financeDeployments/finance-1'), {
      ownerUid: 'person-1',
      deploymentId: 'job-1',
      clientAmount: 50000,
    });

    await setDoc(doc(db, 'freelancerPayments/payment-1'), {
      ownerUid: 'person-1',
      deploymentId: 'job-1',
      freelancerUid: 'person-1',
      amount: 5000,
    });

    await setDoc(doc(db, 'freelancerPayments/payment-2'), {
      ownerUid: 'deployer-1',
      deploymentId: 'job-2',
      freelancerUid: 'freelancer-1',
      amount: 6000,
    });
  });
});

after(async () => {
  if (env) await env.cleanup();
});

test('Super Admin mode denies finance even with multiple roles', async () => {
  const db = dbAs('person-1', 'superAdmin');

  await assertFails(getDoc(doc(db, 'financeDeployments/finance-1')));
  await assertFails(getDoc(doc(db, 'freelancerPayments/payment-1')));
  await assertFails(getDoc(doc(db, 'freelancerPayments/payment-2')));
});

test('Freelancer mode allows own assigned payment, not client finance', async () => {
  const db = dbAs('person-1', 'freelancer');

  await assertSucceeds(getDoc(doc(db, 'financeDeployments/finance-1')));
await assertSucceeds(getDoc(doc(db, 'freelancerPayments/payment-1')));
await assertFails(getDoc(doc(db, 'freelancerPayments/payment-2')));
test('Deployer mode allows own deployment finance only', async () => {
  const db = dbAs('person-1', 'deployer');

  await assertSucceeds(getDoc(doc(db, 'financeDeployments/finance-1')));
  await assertFails(getDoc(doc(db, 'freelancerPayments/payment-1')));
  await assertFails(getDoc(doc(db, 'freelancerPayments/payment-2')));
});

test('Unrelated deployer cannot read another owner financial record', async () => {
  const db = dbAs('deployer-1', 'deployer');

  await assertFails(getDoc(doc(db, 'financeDeployments/finance-1')));
});

test('Pending account cannot read operational or financial records', async () => {
  const db = dbAs('pending-1', 'freelancer', 'pending');

  await assertFails(getDoc(doc(db, 'deployments/job-1')));
  await assertFails(getDoc(doc(db, 'financeDeployments/finance-1')));
  await assertFails(getDoc(doc(db, 'freelancerPayments/payment-1')));
});

test('User cannot change their own role or approval status', async () => {
  const db = dbAs('person-1', 'freelancer');

  await assertFails(updateDoc(doc(db, 'users/person-1'), {
    roles: ['superAdmin'],
    approved: true,
  }));
});

test('Client cannot forge a privileged active mode to access finance', async () => {
  const db = dbAs('freelancer-1', 'superAdmin');

  await assertFails(getDoc(doc(db, 'financeDeployments/finance-1')));
});
