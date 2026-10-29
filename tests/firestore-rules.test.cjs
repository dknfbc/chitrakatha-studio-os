const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp } = require('firebase/firestore');
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
      status: 'approved'
    });
await setDoc(doc(db, 'users', 'deployer-1'), {
  displayName: 'Synthetic Test Deployer',
  role: 'deployer',
  status: 'approved'
});

await setDoc(doc(db, 'users', 'freelancer-1'), {
  displayName: 'Synthetic Test Freelancer',
  role: 'freelancer',
  status: 'approved'
});

await setDoc(doc(db, 'users', 'pending-1'), {
  displayName: 'Synthetic Pending User',
  role: 'freelancer',
  status: 'pending'
});
    await setDoc(doc(db, 'financialRecords', 'payment-1'), {
      ownerUid: 'owner-1', amount: 5000
    });
    await setDoc(doc(db, 'deployments', 'job-1'), {
      client: 'Synthetic test only',
      deployerUid: 'deployer-1'
    });
    // Synthetic records for the proposed separated finance partitions.
    // They must remain inaccessible until ownership-aware rules are implemented.
    await setDoc(doc(db, 'financeDeployment', 'job-1'), {
      deployerUid: 'deployer-1',
      clientPackage: 5000,
      advance: 1000,
      balance: 4000
    });
    await setDoc(doc(db, 'financeAssignments', 'assignment-1'), {
      deploymentId: 'job-1',
      deployerUid: 'deployer-1',
      freelancerUid: 'freelancer-1',
      paymentAmount: 500
    });
  });
});


test('a signed-in user can submit only a minimal pending access request', async () => {
  const db = env.authenticatedContext('new-user-1').firestore();
  await assertSucceeds(setDoc(doc(db, 'users', 'new-user-1'), {
    email: 'newuser@example.com',
    requestedRole: 'freelancer',
    status: 'pending',
    role: null,
    createdAt: serverTimestamp()
  }));
});

test('a new user cannot self-approve or assign themselves a privileged role', async () => {
  const db = env.authenticatedContext('new-user-2').firestore();
  await assertFails(setDoc(doc(db, 'users', 'new-user-2'), {
    email: 'newuser@example.com',
    requestedRole: 'freelancer',
    status: 'approved',
    role: 'superAdmin',
    createdAt: serverTimestamp()
  }));
});

test('a user cannot create an access request for another UID', async () => {
  const db = env.authenticatedContext('new-user-3').firestore();
  await assertFails(setDoc(doc(db, 'users', 'victim-1'), {
    email: 'newuser@example.com',
    requestedRole: 'freelancer',
    status: 'pending',
    role: null,
    createdAt: serverTimestamp()
  }));
});


test('a user cannot edit or delete their own profile from the client', async () => {
  const db = env.authenticatedContext('deployer-1').firestore();
  await assertFails(updateDoc(doc(db, 'users', 'deployer-1'), { email: 'changed@example.com' }));
  await assertFails(require('firebase/firestore').deleteDoc(doc(db, 'users', 'deployer-1')));
});

test('pending signup rejects unexpected privilege or profile fields', async () => {
  const db = env.authenticatedContext('new-user-4').firestore();
  await assertFails(setDoc(doc(db, 'users', 'new-user-4'), {
    email: 'newuser@example.com',
    requestedRole: 'freelancer',
    status: 'pending',
    role: null,
    createdAt: serverTimestamp(),
    isAdmin: true
  }));
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
    status: 'approved'
  }));
});

test('a client cannot change role or approval status', async () => {
  const db = env.authenticatedContext('owner-1').firestore();
  await assertFails(updateDoc(doc(db, 'users', 'owner-1'), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users', 'owner-1'), {
    status: 'approved'
  }));
});

test('Super Admin cannot read financial records', async () => {
  const db = env.authenticatedContext('owner-1').firestore();
  await assertFails(getDoc(doc(db, 'financialRecords', 'payment-1')));
});

test('the proposed deployment finance partition stays denied to all current roles', async () => {
  for (const uid of ['owner-1', 'deployer-1', 'freelancer-1', 'pending-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'financeDeployment', 'job-1')));
  }
});

test('the proposed assignment finance partition stays denied to all current roles', async () => {
  for (const uid of ['owner-1', 'deployer-1', 'freelancer-1', 'pending-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'financeAssignments', 'assignment-1')));
  }
});


test('Super Admin remains denied both separated finance collections even with extra role claims', async () => {
  const db = env.authenticatedContext('owner-1', {
    role: 'superAdmin',
    additionalRoles: ['deployer', 'freelancer']
  }).firestore();
  await assertFails(getDoc(doc(db, 'financeDeployment', 'job-1')));
  await assertFails(getDoc(doc(db, 'financeAssignments', 'assignment-1')));
});

test('deployer cannot read another users finance by guessing document IDs', async () => {
  const db = env.authenticatedContext('deployer-1').firestore();
  await assertFails(getDoc(doc(db, 'financeDeployment', 'job-1')));
  await assertFails(getDoc(doc(db, 'financeAssignments', 'assignment-1')));
});

test('approved freelancer cannot read client package or another assignment payment', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();
  await assertFails(getDoc(doc(db, 'financeDeployment', 'job-1')));
  await assertFails(getDoc(doc(db, 'financeAssignments', 'assignment-1')));
});

test('list queries cannot enumerate deployment finance records', async () => {
  for (const uid of ['owner-1', 'deployer-1', 'freelancer-1', 'pending-1']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDocs(collection(db, 'financeDeployment')));
    await assertFails(getDocs(collection(db, 'financeAssignments')));
  }
});

test('unauthenticated clients cannot enumerate separated finance records', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(db, 'financeDeployment')));
  await assertFails(getDocs(collection(db, 'financeAssignments')));
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
test('pending users cannot access operational records', async () => {
  const db = env.authenticatedContext('pending-1').firestore();
  await assertFails(getDoc(doc(db, 'deployments', 'job-1')));
});

test('Deployer cannot read financial records', async () => {
  const db = env.authenticatedContext('deployer-1').firestore();
  await assertFails(getDoc(doc(db, 'financialRecords', 'payment-1')));
});

test('Freelancer cannot read financial records', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();
  await assertFails(getDoc(doc(db, 'financialRecords', 'payment-1')));
});
test('a user cannot modify another users profile', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();

  await assertFails(
    updateDoc(doc(db, 'users', 'owner-1'), {
      displayName: 'Unauthorized Change'
    })
  );
});
test('a freelancer cannot modify financial records', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();

  await assertFails(
    updateDoc(doc(db, 'financialRecords', 'payment-1'), {
      amount: 1
    })
  );
});
test('a freelancer cannot create financial records', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();

  await assertFails(
    setDoc(doc(db, 'financialRecords', 'fake-payment'), {
      ownerUid: 'freelancer-1',
      amount: 999999
    })
  );
});
test('a freelancer cannot promote themselves to superAdmin', async () => {
  const db = env.authenticatedContext('freelancer-1').firestore();

  await assertFails(
    updateDoc(doc(db, 'users', 'freelancer-1'), {
      role: 'superAdmin'
    })
  );
});
