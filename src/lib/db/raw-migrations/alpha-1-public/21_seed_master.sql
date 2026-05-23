INSERT INTO lane_types (company_id, code, name, sort_order)
VALUES
  (NULL, 'general', 'General', 10),
  (NULL, 'inspection', 'Inspection', 20),
  (NULL, 'bodywork', 'Bodywork', 30),
  (NULL, 'paint', 'Paint', 40),
  (NULL, 'delivery', 'Delivery', 50),
  (NULL, 'other', 'Other', 60)
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO statuses (company_id, domain, code, name, sort_order, is_terminal)
VALUES
  (NULL, 'reservation', 'requested', 'Requested', 10, false),
  (NULL, 'reservation', 'confirmed', 'Confirmed', 20, false),
  (NULL, 'reservation', 'checked_in', 'Checked in', 30, false),
  (NULL, 'reservation', 'in_progress', 'In progress', 40, false),
  (NULL, 'reservation', 'completed', 'Completed', 50, true),
  (NULL, 'reservation', 'cancelled', 'Cancelled', 90, true),
  (NULL, 'transport', 'draft', 'Draft', 10, false),
  (NULL, 'transport', 'requested', 'Requested', 20, false),
  (NULL, 'transport', 'inviting', 'Inviting', 30, false),
  (NULL, 'transport', 'assigned', 'Assigned', 40, false),
  (NULL, 'transport', 'accepted', 'Accepted', 50, false),
  (NULL, 'transport', 'pickup_started', 'Pickup started', 60, false),
  (NULL, 'transport', 'in_transit', 'In transit', 70, false),
  (NULL, 'transport', 'delivered', 'Delivered', 80, true),
  (NULL, 'transport', 'cancelled', 'Cancelled', 90, true),
  (NULL, 'transport', 'failed', 'Failed', 100, true)
ON CONFLICT (company_id, domain, code) DO NOTHING;

INSERT INTO roles (company_id, code, name, is_system)
VALUES
  (NULL, 'admin', 'Administrator', true),
  (NULL, 'manager', 'Manager', true),
  (NULL, 'advisor', 'Advisor', true),
  (NULL, 'technician', 'Technician', true),
  (NULL, 'dispatcher', 'Dispatcher', true),
  (NULL, 'viewer', 'Viewer', true)
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO status_transitions (company_id, domain, from_status_id, to_status_id)
SELECT NULL, 'reservation', s1.id, s2.id
FROM statuses s1
JOIN statuses s2 ON s2.company_id IS NOT DISTINCT FROM s1.company_id
WHERE s1.domain = 'reservation'
  AND s2.domain = 'reservation'
  AND (
    (s1.code = 'requested' AND s2.code = 'confirmed') OR
    (s1.code = 'confirmed' AND s2.code = 'checked_in') OR
    (s1.code = 'checked_in' AND s2.code = 'in_progress') OR
    (s1.code = 'in_progress' AND s2.code = 'completed') OR
    (s1.code IN ('requested', 'confirmed') AND s2.code = 'cancelled')
  );

INSERT INTO status_transitions (company_id, domain, from_status_id, to_status_id)
SELECT NULL, 'transport', s1.id, s2.id
FROM statuses s1
JOIN statuses s2 ON s2.company_id IS NOT DISTINCT FROM s1.company_id
WHERE s1.domain = 'transport'
  AND s2.domain = 'transport'
  AND (
    (s1.code = 'draft' AND s2.code = 'requested') OR
    (s1.code = 'requested' AND s2.code = 'inviting') OR
    (s1.code = 'inviting' AND s2.code = 'assigned') OR
    (s1.code = 'assigned' AND s2.code = 'accepted') OR
    (s1.code = 'accepted' AND s2.code = 'pickup_started') OR
    (s1.code = 'pickup_started' AND s2.code = 'in_transit') OR
    (s1.code = 'in_transit' AND s2.code = 'delivered') OR
    (s1.code IN ('requested', 'inviting', 'assigned', 'accepted') AND s2.code = 'cancelled') OR
    (s1.code IN ('pickup_started', 'in_transit') AND s2.code = 'failed')
  );

INSERT INTO notification_rules (company_id, event_key, channel, target_type, template_key)
VALUES
  (NULL, 'reservation.confirmed', 'email', 'customer', 'reservation_confirmed_email'),
  (NULL, 'reservation.cancelled', 'email', 'customer', 'reservation_cancelled_email'),
  (NULL, 'transport.invited', 'email', 'vendor', 'transport_invited_email'),
  (NULL, 'transport.invited', 'portal', 'vendor', 'transport_invited_portal'),
  (NULL, 'transport.accepted', 'portal', 'store_user', 'transport_accepted_portal'),
  (NULL, 'transport.failed', 'portal', 'store_user', 'transport_failed_portal')
ON CONFLICT (company_id, event_key, channel, target_type) DO NOTHING;
