CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name, role, active_role, is_email_verified, is_active, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'client'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'client'),
    false,
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  IF COALESCE(NEW.raw_user_meta_data->>'role', 'client') = 'client' THEN
    INSERT INTO public.client_profiles (user_id, notification_email, notification_in_app)
    VALUES (NEW.id, true, true)
    ON CONFLICT (user_id) DO NOTHING;
  ELSIF NEW.raw_user_meta_data->>'role' = 'scout' THEN
    INSERT INTO public.scout_profiles (user_id, scout_status, total_completions, notification_email, notification_in_app)
    VALUES (NEW.id, 'PendingVerification', 0, true, true)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS trigger AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.users SET is_email_verified = true, updated_at = NOW() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_confirmed();
