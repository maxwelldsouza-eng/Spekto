import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, ActivityIndicator, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../config/supabase'
import { COLORS, SHADOWS } from '../theme'
import StatusBadge from '../components/StatusBadge'
import LoadingView from '../components/LoadingView'

const SUPABASE_URL = 'https://nyvnvtxhlnjvfhcmnihh.supabase.co'

const TYPE_LABELS = {
  external: 'External only',
  internal: 'Internal only',
  internalExternal: 'Internal + External',
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateTime(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function InspectionDetailScreen({ route, navigation }) {
  const { inspectionId } = route.params
  const [inspection, setInspection] = useState(null)
  const [captures, setCaptures] = useState([])
  const [dispute, setDispute] = useState(null)
  const [messages, setMessages] = useState([])
  const [rating, setRating] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [submittingResponse, setSubmittingResponse] = useState(false)

  const load = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    setUser(authUser)

    const [inspRes, captRes, ratingRes] = await Promise.all([
      supabase.from('inspections').select('*, instructions(*)').eq('id', inspectionId).single(),
      supabase.from('captures').select('*').eq('inspection_id', inspectionId)
        .eq('is_deleted', false).eq('is_replaced', false)
        .order('capture_type').order('recorded_at'),
      supabase.from('inspection_ratings').select('*').eq('inspection_id', inspectionId).maybeSingle(),
    ])

    setInspection(inspRes.data)
    setCaptures(captRes.data || [])
    setRating(ratingRes.data)

    if (inspRes.data?.status === 'Disputed') {
      const { data: dsp } = await supabase.from('disputes').select('*')
        .eq('inspection_id', inspectionId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      setDispute(dsp)
      if (dsp) {
        const { data: msgs } = await supabase.from('dispute_messages').select('*')
          .eq('dispute_id', dsp.id).eq('is_internal', false)
          .or('sent_by_type.eq.scout,recipient_type.eq.Scout')
          .order('created_at')
        setMessages(msgs || [])
      }
    }

    setLoading(false)
  }, [inspectionId])

  useEffect(() => {
    navigation.setOptions({ title: '' })
    load()
  }, [load, navigation])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const handleAccept = async () => {
    setAccepting(true)
    const { error } = await supabase.from('inspections')
      .update({ scout_id: user.id, status: 'Accepted', updated_at: new Date().toISOString() })
      .eq('id', inspectionId).eq('status', 'Posted')
    setAccepting(false)
    if (error) {
      Alert.alert('Error', 'Could not accept this job. It may have already been taken.')
    } else {
      Alert.alert('Job accepted!', 'This job is now in your active list.')
      load()
    }
  }

  const handleDecline = () => {
    Alert.alert('Decline job', 'Are you sure you want to decline this job?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          setDeclining(true)
          const { data: { session } } = await supabase.auth.getSession()
          await fetch(`${SUPABASE_URL}/functions/v1/decline-inspection`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ inspection_id: inspectionId }),
          })
          setDeclining(false)
          navigation.goBack()
        },
      },
    ])
  }

  const handleStartRecording = () => {
    navigation.navigate('Recording', {
      inspectionId,
      inspectionType: inspection.inspection_type,
    })
  }

  const handleSubmitResponse = async () => {
    if (!responseText.trim()) {
      Alert.alert('Empty response', 'Please type a response.')
      return
    }
    setSubmittingResponse(true)
    const now = new Date().toISOString()
    await supabase.from('dispute_messages').insert({
      dispute_id: dispute.id,
      sent_by_type: 'scout',
      sent_by_id: user.id,
      message: responseText.trim(),
      message_type: 'ScoutResponse',
      is_internal: false,
      recipient_type: 'admin',
      created_at: now,
    })
    await supabase.from('disputes').update({ scout_responded: true }).eq('id', dispute.id)
    setSubmittingResponse(false)
    setResponseText('')
    Alert.alert('Response submitted', 'Your response has been sent to our team.')
    load()
  }

  if (loading) return <LoadingView message="Loading inspection…" />
  if (!inspection) return <LoadingView message="Not found" />

  const insp = inspection
  const isPosted = insp.status === 'Posted'
  const isAccepted = insp.status === 'Accepted'
  const isInProgress = insp.status === 'InProgress'
  const isCompleted = ['Completed', 'PendingPayment', 'Paid', 'Disputed'].includes(insp.status)
  const canRecord = isAccepted || isInProgress
  const showDispute = insp.status === 'Disputed' && dispute
  const needsResponse = showDispute && dispute.status === 'AwaitingResponse' && !dispute.scout_responded
  const isResolved = dispute?.status === 'Resolved'
  const externalCaptures = captures.filter(c => c.capture_type === 'external')
  const internalCaptures = captures.filter(c => c.capture_type === 'internal')

  const instructions = (insp.instructions || []).sort((a, b) => a.display_order - b.display_order)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
      >
        {/* Header */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <StatusBadge status={insp.status} />
            <Text style={styles.ref}>{insp.ref_number}</Text>
          </View>
          <Text style={styles.address}>{insp.address}</Text>
          <View style={styles.metaRow}>
            <MetaItem icon="calendar-outline" label={formatDate(insp.date)} />
            {insp.time ? <MetaItem icon="clock-outline" label={insp.time} /> : null}
            <MetaItem icon="home-outline" label={TYPE_LABELS[insp.inspection_type] || insp.inspection_type} />
          </View>
          {insp.pricing_snapshot?.pay_to_scout ? (
            <View style={styles.payRow}>
              <MaterialCommunityIcons name="cash" size={16} color={COLORS.green} />
              <Text style={styles.payText}>
                Your payout: <Text style={styles.payAmount}>${parseFloat(insp.pricing_snapshot.pay_to_scout).toFixed(2)}</Text>
              </Text>
            </View>
          ) : null}
          {insp.property_link ? (
            <View style={styles.linkRow}>
              <MaterialCommunityIcons name="link-variant" size={14} color={COLORS.purple} />
              <Text style={styles.linkText}>Property listing available</Text>
            </View>
          ) : null}
        </View>

        {/* Action buttons */}
        {isPosted && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleAccept} disabled={accepting}>
            {accepting ? <ActivityIndicator color={COLORS.white} /> : (
              <Text style={styles.primaryBtnText}>Accept Job</Text>
            )}
          </TouchableOpacity>
        )}

        {canRecord && (
          <View style={styles.actionGroup}>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleStartRecording}>
              <MaterialCommunityIcons name="video" size={18} color={COLORS.white} style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>
                {isInProgress ? 'Continue Recording' : 'Start Recording'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={handleDecline}
              disabled={declining}
            >
              <Text style={styles.dangerBtnText}>Decline Job</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Instructions */}
        {instructions.length > 0 && (
          <Section title="Instructions">
            {instructions.map(inst => (
              <View key={inst.id} style={styles.instructionRow}>
                <MaterialCommunityIcons
                  name={inst.is_checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={18}
                  color={inst.is_checked ? COLORS.green : COLORS.textMuted}
                  style={{ marginRight: 10 }}
                />
                <Text style={styles.instructionText}>{inst.text}</Text>
              </View>
            ))}
          </Section>
        )}

        {/* Captures */}
        {isCompleted && (
          <Section title="Recordings">
            {externalCaptures.length > 0 && (
              <View style={styles.captureGroup}>
                <Text style={styles.captureType}>External ({externalCaptures.length} video{externalCaptures.length !== 1 ? 's' : ''})</Text>
                {externalCaptures.map(c => <CaptureRow key={c.id} capture={c} />)}
              </View>
            )}
            {internalCaptures.length > 0 && (
              <View style={styles.captureGroup}>
                <Text style={styles.captureType}>Internal ({internalCaptures.length} video{internalCaptures.length !== 1 ? 's' : ''})</Text>
                {internalCaptures.map(c => <CaptureRow key={c.id} capture={c} />)}
              </View>
            )}
            {captures.length === 0 && (
              <Text style={styles.emptyText}>No recordings yet</Text>
            )}
          </Section>
        )}

        {/* Dispute section */}
        {showDispute && (
          <Section title="Dispute">
            <View style={[styles.disputeCard, needsResponse && styles.disputeUrgent]}>
              <View style={styles.disputeHeader}>
                <MaterialCommunityIcons
                  name="alert-octagon"
                  size={18}
                  color={needsResponse ? COLORS.red : COLORS.amber}
                />
                <Text style={styles.disputeStatus}>{dispute.status}</Text>
              </View>
              <Text style={styles.disputeReason}>Reason: {dispute.reason}</Text>
              {dispute.description ? (
                <Text style={styles.disputeDesc}>{dispute.description}</Text>
              ) : null}
              {dispute.due_at && !isResolved && (
                <Text style={styles.disputeDue}>
                  Response due: {formatDateTime(dispute.due_at)}
                </Text>
              )}

              {/* Existing messages */}
              {messages.map(msg => (
                <View
                  key={msg.id}
                  style={[styles.msgBubble, msg.sent_by_type === 'scout' ? styles.msgScout : styles.msgAdmin]}
                >
                  <Text style={styles.msgSender}>{msg.sent_by_type === 'scout' ? 'You' : 'Spekto'}</Text>
                  <Text style={styles.msgText}>{msg.message}</Text>
                  <Text style={styles.msgTime}>{formatDateTime(msg.created_at)}</Text>
                </View>
              ))}

              {/* Response form */}
              {needsResponse && (
                <View style={styles.responseForm}>
                  <Text style={styles.responseLabel}>Your response</Text>
                  <TextInput
                    style={styles.responseInput}
                    value={responseText}
                    onChangeText={setResponseText}
                    placeholder="Describe your side of the situation…"
                    placeholderTextColor={COLORS.textMuted}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity
                    style={[styles.primaryBtn, submittingResponse && styles.btnDisabled]}
                    onPress={handleSubmitResponse}
                    disabled={submittingResponse}
                  >
                    {submittingResponse
                      ? <ActivityIndicator color={COLORS.white} />
                      : <Text style={styles.primaryBtnText}>Submit Response</Text>
                    }
                  </TouchableOpacity>
                </View>
              )}

              {dispute.scout_responded && !isResolved && (
                <View style={styles.respondedBanner}>
                  <MaterialCommunityIcons name="check-circle" size={14} color={COLORS.green} />
                  <Text style={styles.respondedText}>Response submitted — awaiting review</Text>
                </View>
              )}

              {isResolved && dispute.resolution && (
                <View style={styles.resolutionBanner}>
                  <Text style={styles.resolutionText}>
                    Resolution: {dispute.resolution.replace(/([A-Z])/g, ' $1').trim()}
                  </Text>
                </View>
              )}
            </View>
          </Section>
        )}

        {/* Payment status */}
        {insp.status === 'PendingPayment' && (
          <View style={[styles.infoBanner, { backgroundColor: COLORS.amberLight }]}>
            <MaterialCommunityIcons name="clock-outline" size={16} color={COLORS.amber} />
            <Text style={[styles.infoBannerText, { color: '#92400E' }]}>
              Payment pending — included in next Tuesday's payout batch
            </Text>
          </View>
        )}

        {insp.status === 'Paid' && (
          <View style={[styles.infoBanner, { backgroundColor: COLORS.greenLight }]}>
            <MaterialCommunityIcons name="check-circle" size={16} color={COLORS.green} />
            <Text style={[styles.infoBannerText, { color: '#166534' }]}>Payment completed</Text>
          </View>
        )}

        {/* Rating received */}
        {rating && (
          <Section title="Rating received">
            <View style={styles.ratingCard}>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map(s => (
                  <MaterialCommunityIcons
                    key={s}
                    name={s <= rating.star_rating ? 'star' : 'star-outline'}
                    size={22}
                    color={s <= rating.star_rating ? COLORS.amber : COLORS.border}
                  />
                ))}
                <Text style={styles.ratingNum}>{rating.star_rating}/5</Text>
              </View>
              {rating.comment ? <Text style={styles.ratingComment}>"{rating.comment}"</Text> : null}
              <Text style={styles.ratingDate}>Received {formatDate(rating.created_at)}</Text>
            </View>
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function MetaItem({ icon, label }) {
  return (
    <View style={styles.metaItem}>
      <MaterialCommunityIcons name={icon} size={13} color={COLORS.textMuted} />
      <Text style={styles.metaText}>{label}</Text>
    </View>
  )
}

function CaptureRow({ capture }) {
  return (
    <View style={styles.captureRow}>
      <MaterialCommunityIcons name="video-outline" size={16} color={COLORS.purple} />
      <View style={styles.captureInfo}>
        <Text style={styles.captureFile} numberOfLines={1}>{capture.file_name}</Text>
        {capture.gps_address ? (
          <Text style={styles.captureGps} numberOfLines={1}>{capture.gps_address}</Text>
        ) : capture.gps_latitude ? (
          <Text style={styles.captureGps}>
            {capture.gps_latitude.toFixed(5)}, {capture.gps_longitude.toFixed(5)}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons name="check-circle" size={16} color={COLORS.green} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    ...SHADOWS.card,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ref: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  address: { fontSize: 18, fontFamily: 'DMSans_800ExtraBold', color: COLORS.dark, marginBottom: 12, lineHeight: 24 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  payText: { fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular' },
  payAmount: { fontFamily: 'Inter_700Bold', color: COLORS.green },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  linkText: { fontSize: 13, color: COLORS.purple, fontFamily: 'Inter_500Medium' },
  primaryBtn: {
    backgroundColor: COLORS.purple,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryBtnText: { color: COLORS.white, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  btnDisabled: { opacity: 0.6 },
  actionGroup: { gap: 0 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: COLORS.red,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  dangerBtnText: { color: COLORS.red, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: COLORS.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, backgroundColor: COLORS.white, borderRadius: 8, padding: 12, ...SHADOWS.card },
  instructionText: { flex: 1, fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  captureGroup: { marginBottom: 12 },
  captureType: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.purple, marginBottom: 8 },
  captureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.white, borderRadius: 8, padding: 12, marginBottom: 6, ...SHADOWS.card,
  },
  captureInfo: { flex: 1 },
  captureFile: { fontSize: 13, fontFamily: 'Inter_500Medium', color: COLORS.text },
  captureGps: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  emptyText: { fontSize: 14, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 16 },
  disputeCard: {
    backgroundColor: COLORS.white, borderRadius: 10, padding: 14,
    borderLeftWidth: 3, borderLeftColor: COLORS.amber, ...SHADOWS.card,
  },
  disputeUrgent: { borderLeftColor: COLORS.red },
  disputeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  disputeStatus: { fontSize: 14, fontFamily: 'Inter_700Bold', color: COLORS.text },
  disputeReason: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 4 },
  disputeDesc: { fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular', marginBottom: 8, lineHeight: 20 },
  disputeDue: { fontSize: 12, color: COLORS.red, fontFamily: 'Inter_500Medium', marginBottom: 12 },
  msgBubble: { borderRadius: 8, padding: 10, marginBottom: 8 },
  msgScout: { backgroundColor: COLORS.purpleLight, marginLeft: 24 },
  msgAdmin: { backgroundColor: '#F3F4F6', marginRight: 24 },
  msgSender: { fontSize: 11, fontFamily: 'Inter_700Bold', color: COLORS.textMuted, marginBottom: 4 },
  msgText: { fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  msgTime: { fontSize: 10, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 4 },
  responseForm: { marginTop: 12 },
  responseLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.text, marginBottom: 6 },
  responseInput: {
    backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 8, padding: 12, fontSize: 14, color: COLORS.text,
    fontFamily: 'Inter_400Regular', minHeight: 100, marginBottom: 10,
  },
  respondedBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  respondedText: { fontSize: 13, color: COLORS.green, fontFamily: 'Inter_500Medium' },
  resolutionBanner: { backgroundColor: COLORS.purpleLight, borderRadius: 8, padding: 10, marginTop: 10 },
  resolutionText: { fontSize: 13, color: COLORS.purple, fontFamily: 'Inter_600SemiBold' },
  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, padding: 14, marginBottom: 12,
  },
  infoBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium' },
  ratingCard: { backgroundColor: COLORS.white, borderRadius: 10, padding: 14, ...SHADOWS.card },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  ratingNum: { fontSize: 16, fontFamily: 'Inter_700Bold', color: COLORS.text, marginLeft: 4 },
  ratingComment: { fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular', fontStyle: 'italic', lineHeight: 20, marginBottom: 6 },
  ratingDate: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
})
