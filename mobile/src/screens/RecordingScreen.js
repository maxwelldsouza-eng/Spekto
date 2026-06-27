import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import * as Location from 'expo-location'
import * as FileSystem from 'expo-file-system'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../config/supabase'
import { COLORS, SHADOWS } from '../theme'

const TYPE_LABELS = { external: 'External', internal: 'Internal' }

function bytesToMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1)
}

export default function RecordingScreen({ route, navigation }) {
  const { inspectionId, inspectionType } = route.params
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [micPermission, requestMicPermission] = useMicrophonePermissions()
  const [locationPermission, setLocationPermission] = useState(null)
  const [user, setUser] = useState(null)
  const [inspection, setInspection] = useState(null)
  const [instructions, setInstructions] = useState([])
  const [captures, setCaptures] = useState([])
  const [captureMode, setCaptureMode] = useState(inspectionType === 'internal' ? 'internal' : 'external')
  const [isRecording, setIsRecording] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadLabel, setUploadLabel] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [facing, setFacing] = useState('back')
  const cameraRef = useRef(null)

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      setUser(authUser)

      const [inspRes, captRes] = await Promise.all([
        supabase.from('inspections').select('*, instructions(*)').eq('id', inspectionId).single(),
        supabase.from('captures').select('*').eq('inspection_id', inspectionId)
          .eq('is_deleted', false).eq('is_replaced', false).order('recorded_at'),
      ])
      setInspection(inspRes.data)
      setInstructions((inspRes.data?.instructions || []).sort((a, b) => a.display_order - b.display_order))
      setCaptures(captRes.data || [])

      const locPerm = await Location.requestForegroundPermissionsAsync()
      setLocationPermission(locPerm.status === 'granted')
    }
    init()
  }, [inspectionId])

  const requestPermissions = async () => {
    if (!cameraPermission?.granted) await requestCameraPermission()
    if (!micPermission?.granted) await requestMicPermission()
  }

  const handleOpenCamera = async () => {
    await requestPermissions()
    if (!cameraPermission?.granted || !micPermission?.granted) {
      Alert.alert('Permissions required', 'Camera and microphone access are needed to record.')
      return
    }
    setShowCamera(true)
  }

  const getGps = async () => {
    if (!locationPermission) return { lat: null, lng: null, address: null }
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeout: 15000,
      })
      let address = null
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
        if (geo[0]) {
          const g = geo[0]
          address = [g.street, g.city, g.region].filter(Boolean).join(', ')
        }
      } catch { /* address optional */ }
      return { lat: loc.coords.latitude, lng: loc.coords.longitude, address }
    } catch {
      return { lat: null, lng: null, address: null }
    }
  }

  const startRecording = async () => {
    if (!cameraRef.current) return
    setIsRecording(true)
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 600 })
      setIsRecording(false)
      setShowCamera(false)
      await uploadVideo(video.uri)
    } catch (e) {
      setIsRecording(false)
      setShowCamera(false)
      Alert.alert('Recording error', e.message || 'Could not record video.')
    }
  }

  const stopRecording = () => {
    if (cameraRef.current) cameraRef.current.stopRecording()
  }

  const uploadVideo = async (uri) => {
    setIsUploading(true)
    setUploadLabel('Getting GPS location…')

    const { lat, lng, address } = await getGps()
    const timestamp = Date.now()
    const fileName = `${captureMode}-${timestamp}.mp4`
    const storagePath = `${inspectionId}/${fileName}`

    setUploadLabel('Uploading video…')

    try {
      // Mark as InProgress on first upload
      if (captures.length === 0) {
        await supabase.from('inspections').update({
          status: 'InProgress',
          updated_at: new Date().toISOString(),
        }).eq('id', inspectionId)
      }

      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(uri, { size: true })
      const fileSizeBytes = fileInfo.size || 0

      // Upload to same Supabase captures bucket used by the web app
      const response = await fetch(uri)
      const blob = await response.blob()
      const { error: storageErr } = await supabase.storage
        .from('captures')
        .upload(storagePath, blob, { contentType: 'video/mp4', upsert: false })

      if (storageErr) throw new Error(storageErr.message)

      const { data: urlData } = supabase.storage.from('captures').getPublicUrl(storagePath)

      setUploadLabel('Saving record…')
      const { data: captureRow, error: insertErr } = await supabase.from('captures').insert({
        inspection_id: inspectionId,
        scout_id: user.id,
        capture_type: captureMode,
        video_url: urlData.publicUrl,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
        gps_latitude: lat,
        gps_longitude: lng,
        gps_address: address,
        recorded_at: new Date().toISOString(),
      }).select().single()

      if (insertErr) throw new Error(insertErr.message)

      setCaptures(prev => [...prev, captureRow])
    } catch (err) {
      Alert.alert('Upload failed', err.message || 'Could not upload video. Please try again.')
    }

    setIsUploading(false)
    setUploadLabel('')
  }

  const deleteCapture = (captureId) => {
    Alert.alert('Delete recording', 'Remove this recording?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('captures').update({
            is_deleted: true,
            deleted_at: new Date().toISOString(),
          }).eq('id', captureId)
          setCaptures(prev => prev.filter(c => c.id !== captureId))
        },
      },
    ])
  }

  const toggleInstruction = async (inst) => {
    const newVal = !inst.is_checked
    await supabase.from('instructions').update({ is_checked: newVal }).eq('id', inst.id)
    setInstructions(prev => prev.map(i => i.id === inst.id ? { ...i, is_checked: newVal } : i))
  }

  const isReady = () => {
    const extCaptures = captures.filter(c => c.capture_type === 'external')
    const intCaptures = captures.filter(c => c.capture_type === 'internal')
    if (inspectionType === 'external') return extCaptures.length > 0
    if (inspectionType === 'internal') return intCaptures.length > 0
    return extCaptures.length > 0 && intCaptures.length > 0
  }

  const handleSubmit = async () => {
    if (!isReady()) {
      const needed = inspectionType === 'internalExternal'
        ? 'at least one external and one internal recording'
        : `at least one ${inspectionType} recording`
      Alert.alert('Incomplete', `You need ${needed} before submitting.`)
      return
    }
    Alert.alert('Submit inspection', 'Mark this inspection as complete?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Submit', onPress: async () => {
          setIsSubmitting(true)
          await supabase.from('inspections').update({
            status: 'Completed',
            updated_at: new Date().toISOString(),
          }).eq('id', inspectionId)
          setIsSubmitting(false)
          Alert.alert('Submitted!', 'Inspection is complete. Payment will be included in the next payout batch.', [
            { text: 'OK', onPress: () => navigation.navigate('ScoutTabs') },
          ])
        },
      },
    ])
  }

  // Camera view
  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing={facing}
          mode="video"
        />
        <SafeAreaView style={styles.cameraOverlay} edges={['top', 'bottom']}>
          <View style={styles.cameraTopBar}>
            <TouchableOpacity onPress={() => { if (isRecording) stopRecording(); else setShowCamera(false) }} style={styles.cameraBackBtn}>
              <MaterialCommunityIcons name="close" size={24} color={COLORS.white} />
            </TouchableOpacity>
            <View style={styles.captureModeTag}>
              <Text style={styles.captureModeText}>{TYPE_LABELS[captureMode]} Recording</Text>
            </View>
            <TouchableOpacity onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} style={styles.flipBtn}>
              <MaterialCommunityIcons name="camera-flip" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          {isRecording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>REC</Text>
            </View>
          )}

          <View style={styles.cameraBottomBar}>
            <TouchableOpacity
              style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              <View style={[styles.recordBtnInner, isRecording && styles.recordBtnInnerStop]} />
            </TouchableOpacity>
            <Text style={styles.recordHint}>
              {isRecording ? 'Tap to stop' : 'Tap to record'}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    )
  }

  const extCaptures = captures.filter(c => c.capture_type === 'external')
  const intCaptures = captures.filter(c => c.capture_type === 'internal')

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <Text style={styles.screenTitle}>Record Inspection</Text>
        {inspection && (
          <Text style={styles.address} numberOfLines={2}>{inspection.address}</Text>
        )}

        {/* Upload progress */}
        {isUploading && (
          <View style={styles.uploadBanner}>
            <ActivityIndicator color={COLORS.purple} size="small" />
            <Text style={styles.uploadLabel}>{uploadLabel}</Text>
          </View>
        )}

        {/* Capture mode tabs (for internalExternal) */}
        {inspectionType === 'internalExternal' && (
          <View style={styles.modeTabRow}>
            {['external', 'internal'].map(mode => (
              <TouchableOpacity
                key={mode}
                style={[styles.modeTab, captureMode === mode && styles.modeTabActive]}
                onPress={() => setCaptureMode(mode)}
              >
                <Text style={[styles.modeTabText, captureMode === mode && styles.modeTabTextActive]}>
                  {TYPE_LABELS[mode]}
                </Text>
                {(mode === 'external' ? extCaptures : intCaptures).length > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>
                      {(mode === 'external' ? extCaptures : intCaptures).length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Record button */}
        <TouchableOpacity
          style={[styles.recordCard, isUploading && styles.cardDisabled]}
          onPress={handleOpenCamera}
          disabled={isUploading}
          activeOpacity={0.7}
        >
          <View style={styles.recordIconCircle}>
            <MaterialCommunityIcons name="video-plus" size={32} color={COLORS.purple} />
          </View>
          <Text style={styles.recordCardTitle}>Record {TYPE_LABELS[captureMode]} Video</Text>
          <Text style={styles.recordCardSub}>Tap to open camera</Text>
        </TouchableOpacity>

        {/* Existing recordings for current mode */}
        {(captureMode === 'external' ? extCaptures : intCaptures).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {TYPE_LABELS[captureMode]} Recordings ({(captureMode === 'external' ? extCaptures : intCaptures).length})
            </Text>
            {(captureMode === 'external' ? extCaptures : intCaptures).map(c => (
              <View key={c.id} style={styles.captureRow}>
                <MaterialCommunityIcons name="check-circle" size={18} color={COLORS.green} />
                <View style={styles.captureInfo}>
                  <Text style={styles.captureFile} numberOfLines={1}>{c.file_name}</Text>
                  {c.file_size_bytes ? <Text style={styles.captureSize}>{bytesToMB(c.file_size_bytes)} MB</Text> : null}
                  {c.gps_latitude ? (
                    <Text style={styles.captureGps} numberOfLines={1}>
                      📍 {c.gps_address || `${c.gps_latitude.toFixed(4)}, ${c.gps_longitude.toFixed(4)}`}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={() => deleteCapture(c.id)} style={styles.deleteBtn}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color={COLORS.red} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Instructions checklist */}
        {instructions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Checklist</Text>
            {instructions.map(inst => (
              <TouchableOpacity
                key={inst.id}
                style={styles.instructionRow}
                onPress={() => toggleInstruction(inst)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={inst.is_checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={20}
                  color={inst.is_checked ? COLORS.green : COLORS.textMuted}
                />
                <Text style={[styles.instructionText, inst.is_checked && styles.instructionDone]}>
                  {inst.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Readiness summary */}
        <View style={styles.readinessCard}>
          <Text style={styles.readinessTitle}>Submission readiness</Text>
          {(inspectionType === 'external' || inspectionType === 'internalExternal') && (
            <ReadinessRow label="External recording" done={extCaptures.length > 0} count={extCaptures.length} />
          )}
          {(inspectionType === 'internal' || inspectionType === 'internalExternal') && (
            <ReadinessRow label="Internal recording" done={intCaptures.length > 0} count={intCaptures.length} />
          )}
        </View>

        {/* Submit button */}
        <TouchableOpacity
          style={[styles.submitBtn, (!isReady() || isSubmitting) && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!isReady() || isSubmitting}
        >
          {isSubmitting
            ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.submitBtnText}>Submit Inspection</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.saveBtnText}>Save & Continue Later</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function ReadinessRow({ label, done, count }) {
  return (
    <View style={styles.readinessRow}>
      <MaterialCommunityIcons
        name={done ? 'check-circle' : 'circle-outline'}
        size={16}
        color={done ? COLORS.green : COLORS.border}
      />
      <Text style={[styles.readinessLabel, done && styles.readinessLabelDone]}>{label}</Text>
      {count > 0 && <Text style={styles.readinessCount}>{count} video{count !== 1 ? 's' : ''}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontFamily: 'DMSans_800ExtraBold', color: COLORS.dark, marginBottom: 4 },
  address: { fontSize: 14, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 16 },
  uploadBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.purpleLight, borderRadius: 10, padding: 14, marginBottom: 12,
  },
  uploadLabel: { fontSize: 14, color: COLORS.purple, fontFamily: 'Inter_500Medium' },
  modeTabRow: { flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: 10, padding: 4, marginBottom: 16 },
  modeTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  modeTabActive: { backgroundColor: COLORS.purple },
  modeTabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.textMuted },
  modeTabTextActive: { color: COLORS.white },
  countBadge: { backgroundColor: COLORS.green, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  countBadgeText: { fontSize: 10, color: COLORS.white, fontFamily: 'Inter_700Bold' },
  recordCard: {
    backgroundColor: COLORS.white, borderRadius: 12, padding: 24,
    alignItems: 'center', marginBottom: 16, ...SHADOWS.card,
    borderWidth: 2, borderColor: COLORS.purpleLight, borderStyle: 'dashed',
  },
  cardDisabled: { opacity: 0.5 },
  recordIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.purpleLight,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  recordCardTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: COLORS.dark, marginBottom: 4 },
  recordCardSub: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: COLORS.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  captureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.white, borderRadius: 8, padding: 12, marginBottom: 6, ...SHADOWS.card,
  },
  captureInfo: { flex: 1 },
  captureFile: { fontSize: 13, fontFamily: 'Inter_500Medium', color: COLORS.text },
  captureSize: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 },
  captureGps: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  deleteBtn: { padding: 4 },
  instructionRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: COLORS.white, borderRadius: 8, padding: 12, marginBottom: 6, ...SHADOWS.card,
  },
  instructionText: { flex: 1, fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  instructionDone: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  readinessCard: { backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 16, ...SHADOWS.card },
  readinessTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: COLORS.text, marginBottom: 12 },
  readinessRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  readinessLabel: { flex: 1, fontSize: 14, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  readinessLabelDone: { color: COLORS.text },
  readinessCount: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  submitBtn: {
    backgroundColor: COLORS.green, borderRadius: 10, paddingVertical: 15,
    alignItems: 'center', marginBottom: 10,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: COLORS.white, fontSize: 15, fontFamily: 'Inter_700Bold' },
  saveBtn: { alignItems: 'center', paddingVertical: 12 },
  saveBtnText: { color: COLORS.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium' },
  // Camera styles
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraTopBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  cameraBackBtn: { padding: 8 },
  flipBtn: { padding: 8 },
  captureModeTag: {
    backgroundColor: 'rgba(86,5,145,0.8)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  captureModeText: { color: COLORS.white, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  recordingIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    position: 'absolute', top: 80, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.red },
  recText: { color: COLORS.white, fontSize: 12, fontFamily: 'Inter_700Bold' },
  cameraBottomBar: { alignItems: 'center', paddingBottom: 24, gap: 12 },
  recordBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: COLORS.white,
    justifyContent: 'center', alignItems: 'center',
  },
  recordBtnActive: { borderColor: COLORS.red },
  recordBtnInner: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: COLORS.red,
  },
  recordBtnInnerStop: { borderRadius: 8, width: 28, height: 28 },
  recordHint: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontFamily: 'Inter_400Regular' },
})
