INSERT INTO pit_v24_poc.lane_types (company_id, code)
VALUES
  (NULL, 'general'),
  (NULL, 'inspection');

INSERT INTO pit_v24_poc.statuses (company_id, domain, code)
VALUES
  (NULL, 'reservation', 'requested'),
  (NULL, 'reservation', 'confirmed'),
  (NULL, 'transport', 'draft'),
  (NULL, 'transport', 'assigned');

INSERT INTO pit_v24_poc.status_transitions (company_id, from_status_id, to_status_id)
SELECT NULL, statuses_from.id, statuses_to.id
FROM pit_v24_poc.statuses AS statuses_from
JOIN pit_v24_poc.statuses AS statuses_to
  ON statuses_to.domain = statuses_from.domain
WHERE statuses_from.code IN ('requested', 'draft')
  AND statuses_to.code IN ('confirmed', 'assigned');

INSERT INTO pit_v24_poc.notification_rules (company_id, event_key, channel)
VALUES
  (NULL, 'reservation.confirmed', 'email'),
  (NULL, 'transport.invited', 'email');

INSERT INTO pit_v24_poc.roles (company_id, code)
VALUES
  (NULL, 'admin'),
  (NULL, 'advisor');
