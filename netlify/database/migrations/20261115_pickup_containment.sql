-- Additive only. Starts paused; an authenticated Admin must explicitly resume.
CREATE TABLE pickup_write_control_events (
  id uuid PRIMARY KEY,
  revision integer NOT NULL UNIQUE CHECK (revision > 0),
  previous_revision integer NOT NULL CHECK (previous_revision = revision - 1),
  paused boolean NOT NULL,
  actor text NOT NULL CHECK (actor IN ('ADMIN','SYSTEM')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE pickup_write_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  paused boolean NOT NULL,
  revision integer NOT NULL REFERENCES pickup_write_control_events(revision),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION preserve_pickup_control_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Pickup containment evidence is append-only';
END;
$$;
CREATE TRIGGER pickup_control_events_no_edit BEFORE UPDATE OR DELETE ON pickup_write_control_events
  FOR EACH ROW EXECUTE FUNCTION preserve_pickup_control_evidence();
CREATE TRIGGER pickup_control_events_no_truncate BEFORE TRUNCATE ON pickup_write_control_events
  FOR EACH STATEMENT EXECUTE FUNCTION preserve_pickup_control_evidence();
CREATE TRIGGER pickup_control_no_delete BEFORE DELETE ON pickup_write_control
  FOR EACH ROW EXECUTE FUNCTION preserve_pickup_control_evidence();
CREATE TRIGGER pickup_control_no_truncate BEFORE TRUNCATE ON pickup_write_control
  FOR EACH STATEMENT EXECUTE FUNCTION preserve_pickup_control_evidence();
INSERT INTO pickup_write_control_events(id,revision,previous_revision,paused,actor,reason)
  VALUES ('a79c0000-0000-4000-8000-000000000001',1,0,true,'SYSTEM','Initial containment: explicit Admin resume required after release verification');
INSERT INTO pickup_write_control(singleton,paused,revision) VALUES(true,true,1);
