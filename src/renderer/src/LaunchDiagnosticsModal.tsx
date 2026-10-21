import { t, getLocale, translateMessage as mt } from '../../shared/i18n'
import { CheckCircleFilled, CloseCircleFilled, WarningFilled } from '@ant-design/icons'
import { Alert, Button, List, Modal, Space, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { BrowserProfileView, LaunchDiagnosticReport } from '../../shared/types'

interface LaunchDiagnosticsModalProps {
  profile?: BrowserProfileView
  report?: LaunchDiagnosticReport
  open: boolean
  onClose: () => void
}


export function LaunchDiagnosticsModal({ profile, report, open, onClose }: LaunchDiagnosticsModalProps) {
  const [explaining, setExplaining] = useState(false)
  const [fingerprintReport, setFingerprintReport] = useState('')
  const [fingerprintError, setFingerprintError] = useState('')

  useEffect(() => {
    setFingerprintReport('')
    setFingerprintError('')
    setExplaining(false)
  }, [open, profile?.id])

  async function explainFingerprint(): Promise<void> {
    if (!profile) return
    setExplaining(true)
    setFingerprintError('')
    try {
      setFingerprintReport(await window.browserApi.profiles.explainFingerprint(profile.id))
    } catch (error) {
      setFingerprintError(error instanceof Error ? error.message : String(error))
    } finally {
      setExplaining(false)
    }
  }

  const statusView = {
    pass: { color: 'success', text: t("通过"), icon: <CheckCircleFilled /> },
    warning: { color: 'warning', text: t("提醒"), icon: <WarningFilled /> },
    error: { color: 'error', text: t("失败"), icon: <CloseCircleFilled /> }
  } as const

  return (
    <Modal open={open} title={t("启动诊断{0}", profile ? ` · ${profile.name}` : '')} footer={null} onCancel={onClose} destroyOnHidden>
      {report && (
        <>
          <Alert
            type={report.ready ? 'success' : 'error'}
            showIcon
            title={report.ready ? t("未发现阻止启动的问题") : t("发现可能导致启动失败的问题")}
            description={report.ready ? t("提醒项不会阻止启动，但建议在正式业务使用前处理。") : t("请处理失败项后重新诊断。")}
          />
          {profile && (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <Button loading={explaining} onClick={() => void explainFingerprint()}>
                查看 Apostate 指纹组合报告（--fingerprint-explain）
              </Button>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                此诊断调用当前内核的原生组合报告，不会打开浏览器窗口。报告中的 limitations 用于说明无法应用或可能不一致的字段；它不替代网页运行时检测。
              </Typography.Paragraph>
              {fingerprintError && <Alert type="error" showIcon message={fingerprintError} style={{ marginBottom: 12 }} />}
              {fingerprintReport && (
                <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 340, background: '#111827', color: '#e5e7eb', padding: 12, borderRadius: 8, fontSize: 12 }}>
                  {fingerprintReport}
                </pre>
              )}
            </div>
          )}
          <List
            className="diagnostics-list"
            dataSource={report.checks}
            renderItem={(check) => {
              const view = statusView[check.status]
              return (
                <List.Item>
                  <List.Item.Meta
                    title={<Space><Tag color={view.color} icon={view.icon}>{view.text}</Tag><Typography.Text strong>{mt(check.label)}</Typography.Text></Space>}
                    description={mt(check.message)}
                  />
                </List.Item>
              )
            }}
          />
          <Typography.Text type="secondary">{t("检查时间：{0}", new Date(report.checkedAt).toLocaleString(getLocale()))}</Typography.Text>
        </>
      )}
    </Modal>
  )
}
