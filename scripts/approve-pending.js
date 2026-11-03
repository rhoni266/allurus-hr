// Finds all pending users, devices, or items and approves them.
const { admin } = require('./admin');

(async () => {
  const fb = admin();
  const db = fb.firestore();

  console.log('=== Checking Pending Users ===');
  const pendingUsersSnap = await db.collection('users').where('pending', '==', true).get();
  console.log(`Found ${pendingUsersSnap.size} pending user(s).`);

  if (!pendingUsersSnap.empty) {
    for (const docSnap of pendingUsersSnap.docs) {
      const u = docSnap.data();
      const uid = docSnap.id;
      console.log(`\nUser: ${uid}`);
      console.log(`  Email: ${u.email}`);
      console.log(`  Tenant: ${u.tenantId}`);
      console.log(`  Current Name: ${u.name}`);
      console.log(`  Current EmpId: ${u.empId || '(none)'}`);

      let tenantId = u.tenantId;
      let icMatch = (u.email || '').match(/^(\d{12})\./);
      let ic = icMatch ? icMatch[1] : null;

      let empId = u.empId || '';
      let empName = u.name && u.name !== 'Waiting for approval' ? u.name : '';

      // If we don't have empId or full name, check staffKeys or directory bucket
      if (tenantId && ic) {
        const staffKeyRef = db.collection('staffKeys').doc(`${tenantId}~${ic}`);
        const staffKeySnap = await staffKeyRef.get();
        if (staffKeySnap.exists) {
          const kData = staffKeySnap.data();
          if (kData.empId) empId = kData.empId;
          if (kData.name) empName = kData.name;
        }

        if (!empId) {
          // Look up directory bucket in tenant
          const dirSnap = await db.collection('tenants').doc(tenantId).collection('buckets').doc('directory').get();
          if (dirSnap.exists) {
            const dirData = dirSnap.data();
            const employees = dirData.f?.employees || dirData.employees || [];
            // Handle both array and map formats
            const empList = Array.isArray(employees) ? employees : Object.values(employees);
            const found = empList.find(e => (e.ic || '').replace(/\D/g, '') === ic);
            if (found) {
              empId = found.id;
              empName = `${found.first || ''} ${found.last || ''}`.trim() || found.name || empName;
              console.log(`  Matched to employee from directory: ${found.id} (${empName})`);
            }
          }
        }
      }

      const updates = {
        pending: false,
      };
      if (empId) updates.empId = empId;
      if (empName) updates.name = empName;
      if (u.keyProof) updates.keyProof = fb.firestore.FieldValue.delete();

      await db.collection('users').doc(uid).update(updates);
      console.log(`  -> Approved user ${uid}: pending=false, empId=${empId || '(none)'}, name="${empName || u.name}"`);

      // Also ensure staffKeys is updated
      if (tenantId && ic) {
        const genMatch = (u.email || '').match(/\.g(\d+)@/);
        const gen = genMatch ? parseInt(genMatch[1], 10) : 1;
        const key = `${tenantId}~${ic}`;
        await db.collection('staffKeys').doc(key).set({
          tenantId,
          gen,
          ...(empId ? { empId } : {}),
          ...(empName ? { name: empName } : {})
        }, { merge: true });

        // Clean up any invites or links
        const invSnap = await db.collection('staffInvites').doc(key).get();
        if (invSnap.exists) {
          const link = invSnap.data().link;
          if (link) await db.collection('joinLinks').doc(link).delete().catch(() => {});
          await db.collection('staffInvites').doc(key).delete().catch(() => {});
        }
      }
    }
  }

  // Also check if any tenants have pending attendance devices
  console.log('\n=== Checking Pending Attendance Devices & Leaves ===');
  const tenantsSnap = await db.collection('tenants').get();
  for (const tDoc of tenantsSnap.docs) {
    const tId = tDoc.id;
    const tData = tDoc.data();

    // Directory (employees devices/faces)
    const dirRef = db.collection('tenants').doc(tId).collection('buckets').doc('directory');
    const dirSnap = await dirRef.get();
    if (dirSnap.exists) {
      const data = dirSnap.data();
      let empField = data.f?.employees ? 'f.employees' : (data.employees ? 'employees' : null);
      let employees = data.f?.employees || data.employees;
      let changed = false;

      if (Array.isArray(employees)) {
        employees.forEach(e => {
          if (Array.isArray(e.devices)) {
            e.devices.forEach(d => {
              if (d.status === 'pending') {
                console.log(`Approving device ${d.name || d.id} for ${e.first || e.name} in tenant ${tData.name || tId}`);
                d.status = 'approved';
                changed = true;
              }
            });
          }
          if (e.face && e.face.status === 'pending') {
            console.log(`Confirming face for ${e.first || e.name} in tenant ${tData.name || tId}`);
            e.face.status = 'confirmed';
            changed = true;
          }
        });
        if (changed) {
          if (empField === 'f.employees') {
            await dirRef.update({ 'f.employees': employees });
          } else {
            await dirRef.update({ employees });
          }
          console.log(`Saved updated directory for tenant ${tData.name || tId}`);
        }
      }
    }

    // Pending leaves
    const leaveRef = db.collection('tenants').doc(tId).collection('buckets').doc('leave');
    const leaveSnap = await leaveRef.get();
    if (leaveSnap.exists) {
      const lData = leaveSnap.data();
      let leaves = lData.f?.leaves || lData.leaves;
      let changed = false;
      if (Array.isArray(leaves)) {
        leaves.forEach(l => {
          if (l.status === 'Pending') {
            console.log(`Found pending leave: ${l.id} (${l.type} by emp ${l.empId}) in tenant ${tData.name || tId}`);
            // Note: only approve if appropriate, let's see if there are any
          }
        });
      }
    }
  }

  console.log('\n=== Done checking and approving! ===');
})();
