db.getSiblingDB('unifi').createUser({
  user: 'unifi',
  pwd: 'unifi',
  roles: [
    { role: 'dbOwner', db: 'unifi' },
    { role: 'dbOwner', db: 'unifi_stat' }
  ]
});
db.getSiblingDB('unifi_stat').createUser({
  user: 'unifi',
  pwd: 'unifi',
  roles: [
    { role: 'dbOwner', db: 'unifi_stat' }
  ]
});
