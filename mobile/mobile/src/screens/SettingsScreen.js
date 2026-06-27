import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch, Image,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as WebBrowser from 'expo-web-browser'
import { supabase } from '../config/supabase'
import { COLORS, SHADOWS } from '../theme'
import LoadingView from '../components/LoadingView'

const SUPABASE_URL = 'https://nyvnvtxhlnjvfhcmnihh.supabase.co'

const RTW_STATUS_LABELS = {
  citizen_pr: { label: 'Citizen / Permanent Resident', color: COLORS.green, icon: 'check-circle' },
  verified_unlimited: { label: 'Verified — Unlimited hours', color: COLORS.green, icon: 'check-circle' },
  verified_limited: { label: 'Verified — Limited hours', color: COLORS.amber, icon: 'alert-circle' },
  no_rights: { label: 'No right to work', color: COLORS.red, icon: 'close-circle' },
  mismatch: { label: 'Details mismatch', color: COLORS.red, icon: 'close-circle' },
  failed_technical: { label: 'Technical error', color: COLORS.red, icon: 'alert-circle' },
}

export default function SettingsScreen() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [rtw, setRtw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingPersonal, setSavingPersonal] = useState(false)
  const [savingRtw, setSavingRtw] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingId, setUploadingId] = useState(false)
  const [paymentNotif, setPaymentNotif] = useState(true)

  // Editable fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [abn, setAbn] = useState('')
  const [homeAddress, setHomeAddress] = useState('')

  // RTW form
  const [passportCountry, setPassportCountry] = useState('')
  const [passportNumber, setPassportNumber] = useState('')
  const [givenName, setGivenName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [dob, setDob] = useState('')

  const load = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return

    const [userRes, profileRes, rtwRes, notifRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', authUser.id).single(),
      supabase.from('scout_profiles').select('*').eq('user_id', authUser.id).maybeSingle(),
      supabase.from('rights_to_work').select('*').eq('scout_id', authUser.id).eq('is_current', true).maybeSingle(),
      supabase.from('notification_preferences').select('*')
        .eq('user_id', authUser.id).eq('type', 'payment_released').maybeSingle(),
    ])

    const u = userRes.data
    const p = profileRes.data
    setUser(u)
    setProfile(p)
    setRtw(rtwRes.data)
    setPaymentNotif(notifRes.data?.inapp_enabled !== false)

    setFirstName(u?.first_name || '')
    setLastName(u?.last_name || '')
    setPhone(u?.phone_number || '')
    setAbn(p?.abn || '')
    setHomeAddress(p?.home_address || '')
    setGivenName(u?.first_name || '')
    setFamilyName(u?.last_name || '')
    setDob(p?.date_of_birth || '')

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const savePersonal = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Required', 'First and last name are required.')
      return
    }
    setSavingPersonal(true)
    const now = new Date().toISOString()
    await Promise.all([
      supabase.from('users').update({ first_name: firstName.trim(), last_name: lastName.trim(), phone_number: phone.trim(), updated_at: now }).eq('id', user.id),
      supabase.from('scout_profiles').update({ abn: abn.trim(), home_address: homeAddress.trim(), updated_at: now }).eq('user_id', user.id),
    ])
    setSavingPersonal(false)
    Alert.alert('Saved', 'Your details have been updated.')
    load()
  }

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7,
    })
    if (result.canceled) return
    const uri = result.assets[0].uri
    const ext = uri.split('.').pop()

    setUploadingAvatar(true)
    const response = await fetch(uri)
    const blob = await response.blob()
    const { error } = await supabase.storage.from('avatars').upload(`${user.id}/avatar.${ext}`, blob, { upsert: true, contentType: `image/${ext}` })
    if (!error) {
      const { data } = supabase.storage.from('avatars').getPublicUrl(`${user.id}/avatar.${ext}`)
      await supabase.from('users').update({ avatar_url: data.publicUrl }).eq('id', user.id)
      load()
    } else {
      Alert.alert('Upload failed', error.message)
    }
    setUploadingAvatar(false)
  }

  const pickIdDocument = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9,
    })
    if (result.canceled) return
    const uri = result.assets[0].uri
    const ext = uri.split('.').pop()
    const timestamp = Date.now()
    const fileName = `${timestamp}-id.${ext}`
    const storagePath = `id-documents/${user.id}/${fileName}`

    setUploadingId(true)
    const response = await fetch(uri)
    const blob = await response.blob()
    const { error: storageErr } = await supabase.storage.from('id-documents').upload(storagePath, blob, { upsert: true, contentType: `image/${ext}` })
    if (storageErr) {
      Alert.alert('Upload failed', storageErr.message)
      setUploadingId(false)
      return
    }
    const { data: signedData } = await supabase.storage.from('id-documents').createSignedUrl(storagePath, 315360000)
    if (signedData?.signedUrl) {
      await supabase.from('scout_profiles').update({
        id_document_url: signedData.signedUrl,
        scout_status: 'PendingVerification',
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id)
      Alert.alert('Document uploaded', 'Your ID has been submitted for review. You\'ll be notified once verified.')
      load()
    }
    setUploadingId(false)
  }

  const submitRtw = async () => {
    if (!passportCountry.trim() || !passportNumber.trim() || !givenName.trim() || !familyName.trim() || !dob.trim()) {
      Alert.alert('Required', 'All right-to-work fields are required.')
      return
    }
    setSavingRtw(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/check-work-rights`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passport_country: passportCountry.trim(),
        passport_number: passportNumber.trim(),
        given_name: givenName.trim(),
        family_name: familyName.trim(),
        date_of_birth: dob.trim(),
      }),
    })
    setSavingRtw(false)
    if (res.ok) {
      Alert.alert('Submitted', 'Your right-to-work check has been submitted.')
      load()
    } else {
      const err = await res.json().catch(() => ({}))
      Alert.alert('Error', err.error || 'Could not submit check.')
    }
  }

  const connectStripe = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-connect-onboard`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    })
    if (res.ok) {
      const { url } = await res.json()
      if (url) await WebBrowser.openBrowserAsync(url)
    } else {
      Alert.alert('Error', 'Could not start Stripe onboarding.')
    }
  }

  const togglePaymentNotif = async (val) => {
    setPaymentNotif(val)
    await supabase.from('notification_preferences').upsert(
      { user_id: user.id, type: 'payment_released', inapp_enabled: val, email_enabled: val, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' }
    )
  }

  const handlePasswordReset = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: 'https://maxwelldsouza-eng.github.io/Spekto/auth/reset-password.html',
    })
    if (error) Alert.alert('Error', error.message)
    else Alert.alert('Email sent', 'Check your inbox for a password reset link.')
  }

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ])
  }

  if (loading) return <LoadingView message="Loading settings…" />

  const idVerified = profile?.id_verified === true
  const stripeActive = profile?.stripe_connect_status === 'Active'
  const rtwStatus = rtw?.vsure_status ? RTW_STATUS_LABELS[rtw.vsure_status] : null
  const rtwOk = rtwStatus && (rtw.vsure_status?.startsWith('verified') || rtw.vsure_status === 'citizen_pr' || rtw.admin_decision === 'allowed')

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
      >
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickAvatar} disabled={uploadingAvatar} style={styles.avatarWrap}>
            {user?.avatar_url
              ? <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitials}>
                    {(user?.first_name?.[0] || '') + (user?.last_name?.[0] || '')}
                  </Text>
                </View>
            }
            <View style={styles.avatarEdit}>
              {uploadingAvatar
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <MaterialCommunityIcons name="camera" size={14} color={COLORS.white} />
              }
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarName}>{user?.first_name} {user?.last_name}</Text>
          <Text style={styles.avatarEmail}>{user?.email}</Text>
        </View>

        {/* Personal details */}
        <SectionCard title="Personal Details">
          <Row>
            <Field label="First name" value={firstName} onChangeText={setFirstName} />
            <Field label="Last name" value={lastName} onChangeText={setLastName} />
          </Row>
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="ABN" value={abn} onChangeText={setAbn} keyboardType="number-pad" />
          <Field
            label="Home address"
            value={homeAddress}
            onChangeText={setHomeAddress}
            placeholder="Start typing your address…"
            multiline
          />
          <SaveBtn onPress={savePersonal} loading={savingPersonal} />
        </SectionCard>

        {/* ID Verification */}
        <SectionCard title="Identity Verification">
          <View style={[styles.verifyStatus, idVerified ? styles.verifyOk : styles.verifyPending]}>
            <MaterialCommunityIcons
              name={idVerified ? 'check-circle' : profile?.id_document_url ? 'clock-outline' : 'alert-circle-outline'}
              size={18}
              color={idVerified ? COLORS.green : COLORS.amber}
            />
            <Text style={[styles.verifyText, { color: idVerified ? COLORS.green : COLORS.amber }]}>
              {idVerified ? 'Verified' : profile?.id_document_url ? 'Under review' : 'Not yet submitted'}
            </Text>
          </View>
          {!idVerified && (
            <TouchableOpacity style={styles.uploadBtn} onPress={pickIdDocument} disabled={uploadingId}>
              {uploadingId
                ? <ActivityIndicator color={COLORS.purple} size="small" />
                : <MaterialCommunityIcons name="upload" size={16} color={COLORS.purple} />
              }
              <Text style={styles.uploadBtnText}>
                {profile?.id_document_url ? 'Re-upload ID document' : 'Upload ID document'}
              </Text>
            </TouchableOpacity>
          )}
          <Text style={styles.hint}>Upload a clear photo of your passport or driver's licence</Text>
        </SectionCard>

        {/* Right to Work */}
        <SectionCard title="Right to Work">
          {rtwStatus ? (
            <View style={[styles.verifyStatus, rtwOk ? styles.verifyOk : styles.verifyPending]}>
              <MaterialCommunityIcons name={rtwStatus.icon} size={18} color={rtwStatus.color} />
              <Text style={[styles.verifyText, { color: rtwStatus.color }]}>{rtwStatus.label}</Text>
            </View>
          ) : null}
          {rtw?.visa_expiry_date && (
            <Text style={styles.hint}>Visa expires: {rtw.visa_expiry_date}</Text>
          )}
          {!rtwOk && (
            <View style={styles.rtwForm}>
              <Text style={styles.rtwFormTitle}>Submit right-to-work check</Text>
              <Field label="Passport country" value={passportCountry} onChangeText={setPassportCountry} placeholder="e.g. Australia" />
              <Field label="Passport number" value={passportNumber} onChangeText={setPassportNumber} />
              <Field label="Given name (as on passport)" value={givenName} onChangeText={setGivenName} />
              <Field label="Family name (as on passport)" value={familyName} onChangeText={setFamilyName} />
              <Field label="Date of birth (YYYY-MM-DD)" value={dob} onChangeText={setDob} placeholder="1990-01-15" keyboardType="numbers-and-punctuation" />
              <SaveBtn label="Submit Check" onPress={submitRtw} loading={savingRtw} />
            </View>
          )}
        </SectionCard>

        {/* Stripe Connect */}
        <SectionCard title="Payout Account">
          <View style={[styles.verifyStatus, stripeActive ? styles.verifyOk : styles.verifyPending]}>
            <MaterialCommunityIcons
              name={stripeActive ? 'check-circle' : profile?.stripe_connect_status === 'Pending' ? 'clock-outline' : 'bank-outline'}
              size={18}
              color={stripeActive ? COLORS.green : COLORS.amber}
            />
            <Text style={[styles.verifyText, { color: stripeActive ? COLORS.green : COLORS.amber }]}>
              {stripeActive ? 'Connected' : profile?.stripe_connect_status === 'Pending' ? 'Pending approval' : 'Not connected'}
            </Text>
          </View>
          {!stripeActive && (
            <TouchableOpacity style={styles.uploadBtn} onPress={connectStripe}>
              <MaterialCommunityIcons name="open-in-new" size={16} color={COLORS.purple} />
              <Text style={styles.uploadBtnText}>
                {profile?.stripe_connect_status === 'Pending' ? 'Continue Stripe setup' : 'Connect Stripe account'}
              </Text>
            </TouchableOpacity>
          )}
          <Text style={styles.hint}>Required to receive payout for completed inspections</Text>
        </SectionCard>

        {/* Notifications */}
        <SectionCard title="Notifications">
          <View style={styles.notifRow}>
            <View style={styles.notifLeft}>
              <Text style={styles.notifLabel}>Payment released</Text>
              <Text style={styles.notifSub}>When your payout is processed</Text>
            </View>
            <Switch
              value={paymentNotif}
              onValueChange={togglePaymentNotif}
              trackColor={{ false: COLORS.border, true: COLORS.purple }}
              thumbColor={COLORS.white}
            />
          </View>
        </SectionCard>

        {/* Account */}
        <SectionCard title="Account">
          <TouchableOpacity style={styles.accountRow} onPress={handlePasswordReset}>
            <MaterialCommunityIcons name="lock-reset" size={18} color={COLORS.text} />
            <Text style={styles.accountRowText}>Reset password</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.accountRow, styles.accountRowDanger]} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={18} color={COLORS.red} />
            <Text style={[styles.accountRowText, { color: COLORS.red }]}>Sign out</Text>
          </TouchableOpacity>
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  )
}

function SectionCard({ title, children }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Row({ children }) {
  return <View style={styles.row}>{children}</View>
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, style }) {
  return (
    <View style={[styles.fieldWrap, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, multiline && styles.fieldInputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || ''}
        placeholderTextColor={COLORS.textMuted}
        keyboardType={keyboardType || 'default'}
        autoCapitalize="none"
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  )
}

function SaveBtn({ label = 'Save changes', onPress, loading }) {
  return (
    <TouchableOpacity
      style={[styles.saveBtn, loading && styles.saveBtnDisabled]}
      onPress={onPress}
      disabled={loading}
    >
      {loading
        ? <ActivityIndicator color={COLORS.white} size="small" />
        : <Text style={styles.saveBtnText}>{label}</Text>
      }
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatarWrap: { marginBottom: 10, position: 'relative' },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: { backgroundColor: COLORS.purple, justifyContent: 'center', alignItems: 'center' },
  avatarInitials: { fontSize: 28, fontFamily: 'DMSans_800ExtraBold', color: COLORS.white },
  avatarEdit: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.purple, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.bg,
  },
  avatarName: { fontSize: 18, fontFamily: 'DMSans_800ExtraBold', color: COLORS.dark },
  avatarEmail: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  sectionCard: {
    backgroundColor: COLORS.white, borderRadius: 12, padding: 16, marginBottom: 16, ...SHADOWS.card,
  },
  sectionTitle: {
    fontSize: 14, fontFamily: 'Inter_700Bold', color: COLORS.purple,
    marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', gap: 10 },
  fieldWrap: { marginBottom: 12, flex: 1 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: COLORS.text, marginBottom: 5 },
  fieldInput: {
    backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular',
  },
  fieldInputMulti: { minHeight: 72, paddingTop: 10 },
  saveBtn: {
    backgroundColor: COLORS.purple, borderRadius: 8, paddingVertical: 12,
    alignItems: 'center', marginTop: 4,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: COLORS.white, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  verifyStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 8, padding: 12, marginBottom: 10,
  },
  verifyOk: { backgroundColor: COLORS.greenLight },
  verifyPending: { backgroundColor: COLORS.amberLight },
  verifyText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: COLORS.purple, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8,
  },
  uploadBtnText: { fontSize: 14, color: COLORS.purple, fontFamily: 'Inter_500Medium' },
  hint: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  rtwForm: { marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12 },
  rtwFormTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: COLORS.text, marginBottom: 12 },
  notifRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notifLeft: { flex: 1, marginRight: 12 },
  notifLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', color: COLORS.text },
  notifSub: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  accountRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  accountRowDanger: {},
  accountRowText: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: COLORS.text },
})
