CREATE FUNCTION pit_v24_poc.current_user_company_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pit_v24_poc STABLE AS $$
  SELECT pit_v24_poc.users.company_id
  FROM pit_v24_poc.users
  WHERE pit_v24_poc.users.id = auth.uid()
    AND pit_v24_poc.users.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE FUNCTION pit_v24_poc.current_vendor_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pit_v24_poc STABLE AS $$
  SELECT pit_v24_poc.vendor_users.vendor_id
  FROM pit_v24_poc.vendor_users
  WHERE pit_v24_poc.vendor_users.id = auth.uid()
    AND pit_v24_poc.vendor_users.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE FUNCTION pit_v24_poc.current_vendor_user_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pit_v24_poc STABLE AS $$
  SELECT pit_v24_poc.vendor_users.id
  FROM pit_v24_poc.vendor_users
  WHERE pit_v24_poc.vendor_users.id = auth.uid()
    AND pit_v24_poc.vendor_users.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE FUNCTION pit_v24_poc.vendor_accessible_company_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pit_v24_poc STABLE AS $$
  SELECT pit_v24_poc.vendor_company_memberships.company_id
  FROM pit_v24_poc.vendor_company_memberships
  WHERE pit_v24_poc.vendor_company_memberships.vendor_id = pit_v24_poc.current_vendor_id();
$$;

CREATE FUNCTION pit_v24_poc.vendor_invited_transport_order_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pit_v24_poc STABLE AS $$
  SELECT pit_v24_poc.transport_order_invitations.transport_order_id
  FROM pit_v24_poc.transport_order_invitations
  WHERE pit_v24_poc.transport_order_invitations.vendor_id = pit_v24_poc.current_vendor_id()
    AND pit_v24_poc.transport_order_invitations.deleted_at IS NULL;
$$;

CREATE FUNCTION pit_v24_poc.redact_audit_payload(payload jsonb)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pit_v24_poc STABLE AS $$
  SELECT payload;
$$;

CREATE FUNCTION pit_v24_poc.accept_invitation_and_revoke_others(invitation_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pit_v24_poc AS $$
BEGIN
  RETURN NULL::uuid;
END;
$$;
