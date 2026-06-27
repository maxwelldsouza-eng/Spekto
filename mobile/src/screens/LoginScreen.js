import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native'
import { supabase } from '../config/supabase'
import { COLORS } from '../theme'

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setLoading(false)
    if (error) Alert.alert('Login failed', error.message)
  }

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Enter your email', 'Type your email address above first.')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: 'https://maxwelldsouza-eng.github.io/Spekto/auth/reset-password.html',
    })
    if (error) Alert.alert('Error', error.message)
    else Alert.alert('Email sent', 'Check your inbox for a password reset link.')
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>Spekto</Text>
          <Text style={styles.subtitle}>Scout App</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Sign in</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
          />

          <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotRow}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.btnText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Register')} style={styles.registerRow}>
          <Text style={styles.registerText}>
            Don't have an account? <Text style={styles.registerLink}>Sign up as a Scout</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  logo: {
    fontSize: 36,
    fontFamily: 'DMSans_800ExtraBold',
    color: COLORS.purple,
    letterSpacing: -1,
  },
  subtitle: { fontSize: 14, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 4 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  title: { fontSize: 22, fontFamily: 'DMSans_800ExtraBold', color: COLORS.dark, marginBottom: 20 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.text, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    fontFamily: 'Inter_400Regular',
    marginBottom: 14,
  },
  forgotRow: { alignItems: 'flex-end', marginBottom: 20, marginTop: -6 },
  forgotText: { fontSize: 13, color: COLORS.purple, fontFamily: 'Inter_500Medium' },
  btn: {
    backgroundColor: COLORS.purple,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: COLORS.white, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  registerRow: { marginTop: 24, alignItems: 'center' },
  registerText: { fontSize: 14, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  registerLink: { color: COLORS.purple, fontFamily: 'Inter_600SemiBold' },
})
