// Fake employees and departments shared by the import tests and scripts/make-test-data.js. Not real people.
const DEPTS = [{ id: 'd-ops', name: 'Operations' }, { id: 'd-fin', name: 'Finance' }];
const PEOPLE = [
  { id: 'e1', staffNo: 'A001', first: 'Aisyah', last: 'binti Rahman', email: 'aisyah@contoh.my', phone: '+60123456789', role: 'HR Manager', dept: 'd-ops', status: 'Active', type: 'Full-time', location: 'Kuantan', start: '2022-03-01', salary: 72000, ic: '900101145678', idType: 'mykad', gender: 'female', birthday: '1990-01-01', bank: 'Maybank', accountNo: '112233445566', epfNo: '12345678', address: 'No. 1, Jalan Contoh, Kuantan', nationality: 'Malaysian', emergency: { name: 'Rahman bin Ali', phone: '+60132223344' } },
  { id: 'e2', staffNo: 'A002', first: 'Tan Wei', last: 'Ming', email: 'weiming@contoh.my', phone: '+60198765432', role: 'Accountant', dept: 'd-fin', status: 'Active', type: 'Contract', location: 'Kuantan', start: '2023-07-15', salary: 54000, ic: '880515105431', idType: 'mykad', gender: 'male', birthday: '1988-05-15' },
];
module.exports = { DEPTS, PEOPLE };
