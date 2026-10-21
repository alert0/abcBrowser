import { t, translateMessage as mt } from '../../shared/i18n'
import { ReloadOutlined } from '@ant-design/icons'
import {
  Alert,
  AutoComplete,
  Button,
  Col,
  ColorPicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tabs,
  Typography
} from 'antd'
import { useEffect, useState } from 'react'
import { defaultPlatform, defaultProfileDraft, randomSeed } from '../../shared/defaults'
import {
  applyHardwareProfile,
  defaultApostateGpuAnchor,
  effectiveGpuIdentity,
  HARDWARE_PROFILES,
  hardwareProfile,
  hardwareProfileSummary,
  refreshSeededGpuIdentity
} from '../../shared/hardware-profiles'
import { effectiveNetworkIdentity } from '../../shared/network-identity'
import type { ApostateGpuAnchor, BrowserExtension, BrowserProfileView, EngineStatus, HardwareProfileId, KernelRelease, ProfileDraft, ProxyTestResult } from '../../shared/types'
import { kernelRequiresPro } from '../../shared/kernel-policy'

interface EditorValues extends Omit<ProfileDraft, 'startUrls' | 'color'> {
  startUrlsText: string
  color: string | { toHexString: () => string }
}

interface ProfileEditorProps {
  open: boolean
  profile?: BrowserProfileView
  suggestedIndex: number
  saving: boolean
  extensions: BrowserExtension[]
  engine: EngineStatus | null
  kernels: KernelRelease[]
  groups: string[]
  proEnabled: boolean
  onCancel: () => void
  onSave: (draft: ProfileDraft) => Promise<void>
}

function editorValues(profile: BrowserProfileView | undefined, index: number): EditorValues {
  const draft = profile ?? defaultProfileDraft(index)
  const fingerprint = { ...draft.fingerprint }
  const selectedHardware = hardwareProfile(fingerprint.hardwareProfileId)
  return {
    name: draft.name,
    note: draft.note,
    group: draft.group,
    tags: [...draft.tags],
    extensionIds: [...draft.extensionIds],
    color: draft.color,
    startUrlsText: draft.startUrls.join('\n'),
    kernelVersion: draft.kernelVersion,
    window: { ...draft.window },
    proxy: { ...draft.proxy },
    fingerprint: {
      ...fingerprint,
      deviceMemoryGb: selectedHardware?.hostMatched ? undefined : (fingerprint.deviceMemoryGb ?? selectedHardware?.physicalMemoryGb ?? 8),
      gpuAnchor: selectedHardware?.hostMatched ? 'auto' : (fingerprint.gpuAnchor ?? defaultApostateGpuAnchor(selectedHardware)),
      gpuRenderer: fingerprint.gpuRenderer ?? undefined,
      canvasWebglNoise: selectedHardware?.hostMatched ? false : (fingerprint.canvasWebglNoise ?? false),
      disabledSpoofing: [...draft.fingerprint.disabledSpoofing]
    }
  }
}


export function ProfileEditor({ open, profile, suggestedIndex, saving, extensions, engine, kernels, groups, proEnabled, onCancel, onSave }: ProfileEditorProps) {
  const riskLabels: Record<NonNullable<ProxyTestResult['networkRisk']>, string> = {
    tor: t("Tor 出口"),
    vpn: t("VPN 网络"),
    proxy: t("代理网络"),
    hosting: t("机房网络")
  }

  const [form] = Form.useForm<EditorValues>()
  const proxyProtocol = Form.useWatch(['proxy', 'protocol'], form)
  const proxyPassword = Form.useWatch(['proxy', 'password'], form) ?? ''
  const proxyPasswordStored = Form.useWatch(['proxy', 'passwordStored'], form) === true
  const webrtcPolicy = Form.useWatch(['fingerprint', 'webrtcPolicy'], form) ?? 'proxy_only'
  const fingerprintTimezone = Form.useWatch(['fingerprint', 'timezone'], form)
  const fingerprintLanguage = Form.useWatch(['fingerprint', 'language'], form) ?? 'zh-CN'
  const fingerprintAcceptLanguages = Form.useWatch(['fingerprint', 'acceptLanguages'], form) ?? 'zh-CN,zh,en-US,en'
  const networkIdentityMode = Form.useWatch(['fingerprint', 'networkIdentityMode'], form) ?? 'manual'
  const hardwareProfileId = Form.useWatch(['fingerprint', 'hardwareProfileId'], form) ?? 'legacy-custom'
  const fingerprintPlatform = Form.useWatch(['fingerprint', 'platform'], form) ?? defaultPlatform()
  const fingerprintGpuAnchor = Form.useWatch(['fingerprint', 'gpuAnchor'], form) ?? 'auto'
  const fingerprintSeed = Form.useWatch(['fingerprint', 'seed'], form) ?? 0
  const fingerprintGpuBucket = Form.useWatch(['fingerprint', 'gpuBucket'], form)
  const kernelVersion = Form.useWatch('kernelVersion', form) ?? ''
  const windowMode = Form.useWatch(['window', 'mode'], form) ?? 'auto'
  const [testingProxy, setTestingProxy] = useState(false)
  const [proxyResult, setProxyResult] = useState<ProxyTestResult | null>(null)
  const pinnedKernel = kernels.find((kernel) => kernel.version === kernelVersion)
  const selectedHardware = hardwareProfile(hardwareProfileId)
  const gpuAnchorOptions: Array<{ value: ApostateGpuAnchor; label: string }> = fingerprintPlatform === 'windows'
    ? [
      { value: 'auto', label: '自动选择（由种子和宿主架构决定）' },
      { value: 'windows-d3d11-intel-79dfeb5b4f99', label: 'Windows · Intel · Direct3D 11' },
      { value: 'windows-d3d11-nvidia-0947761dfbe9', label: 'Windows · NVIDIA · Direct3D 11' },
      { value: 'windows-d3d11-qualcomm-6388f9914f3f', label: 'Windows · Qualcomm · Direct3D 11' }
    ]
    : [
      { value: 'auto', label: '自动选择（由种子决定）' },
      { value: 'macos-metal-apple-850a91233555', label: 'macOS · Apple · Metal' }
    ]
  const selectedGpuIdentity = effectiveGpuIdentity({
    hardwareProfileId,
    seed: fingerprintSeed,
    gpuBucket: fingerprintGpuBucket
  })
  const hostPlatform = defaultPlatform()
  const timezoneMismatch = Boolean(proxyResult?.timezone && fingerprintTimezone && proxyResult.timezone !== fingerprintTimezone)
  const networkIdentity = effectiveNetworkIdentity({
    ...form.getFieldValue('fingerprint'),
    language: fingerprintLanguage,
    acceptLanguages: fingerprintAcceptLanguages,
    timezone: fingerprintTimezone,
    networkIdentityMode
  }, proxyResult?.ok ? proxyResult : profile?.proxyCheck)

  useEffect(() => {
    if (open) {
      form.setFieldsValue(editorValues(profile, suggestedIndex))
      setProxyResult(null)
    }
  }, [form, open, profile, suggestedIndex])

  async function testCurrentProxy(): Promise<void> {
    try {
      if (proxyProtocol !== 'direct') await form.validateFields([['proxy', 'host'], ['proxy', 'port']])
      setTestingProxy(true)
      setProxyResult(null)
      setProxyResult(await window.browserApi.proxy.test(form.getFieldValue('proxy'), profile?.id))
    } catch (error) {
      if (!(error && typeof error === 'object' && 'errorFields' in error)) {
        setProxyResult({ ok: false, latencyMs: 0, error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      setTestingProxy(false)
    }
  }

  async function submit(): Promise<void> {
    await form.validateFields()
    const values = form.getFieldsValue(true) as EditorValues
    const color = typeof values.color === 'string' ? values.color : values.color.toHexString()
    await onSave({
      name: values.name,
      note: values.note,
      group: values.group,
      tags: values.tags,
      color,
      startUrls: values.startUrlsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      kernelVersion: values.kernelVersion,
      window: values.window,
      proxy: values.proxy,
      extensionIds: values.extensionIds,
      fingerprint: {
        ...values.fingerprint,
        // These fields belong to the old Prism engine and are intentionally
        // normalized away when a profile is saved for Apostate.
        brand: 'Chrome',
        brandVersion: '',
        disabledSpoofing: []
      }
    })
  }

  const general = (
    <div className="editor-section">
      <Form.Item name="name" label={t("环境名称")} rules={[{ required: true, message: t("请输入环境名称") }]}>
        <Input placeholder={t("例如：美国店铺 01")} maxLength={60} />
      </Form.Item>
      <Form.Item name="color" label={t("标记颜色")}>
        <ColorPicker showText />
      </Form.Item>
      <Form.Item
        name="kernelVersion"
        label={t("浏览器内核")}
        extra={t("长期使用的账号建议固定版本；自动模式会跟随应用当前选择的内核。")}
      >
        <Select
          options={[
            { value: '', label: t("自动跟随当前内核{0}", engine?.version ? ` · ${engine.version}` : '') },
            ...kernels.map((kernel) => ({
              value: kernel.version,
              label: `${kernel.version}${kernelRequiresPro(kernel.version) ? ' · Pro' : ''}${kernel.origin === 'local-build' ? ' · ' + t('本地构建') : ''}`,
              disabled: kernelRequiresPro(kernel.version) && !proEnabled
            })),
            ...(kernelVersion && !pinnedKernel ? [{ value: kernelVersion, label: t("{0} · 当前未安装", kernelVersion) }] : [])
          ]}
        />
      </Form.Item>
      {kernelVersion && !pinnedKernel && (
        <Alert type="error" showIcon message={t("固定内核 {0} 当前不可用", kernelVersion)} description={t("安装该版本后才能启动此环境，或者改回自动跟随。")} />
      )}
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="group" label={t("环境分组")}>
            <AutoComplete
              allowClear
              options={groups.map((value) => ({ value }))}
              placeholder={t("选择已有分组或输入新分组")}
              maxLength={40}
              filterOption={(input, option) => String(option?.value ?? '').toLocaleLowerCase().includes(input.toLocaleLowerCase())}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="tags" label={t("标签")}>
            <Select mode="tags" maxCount={20} tokenSeparators={[',']} placeholder={t("输入后回车")} />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="startUrlsText" label={t("启动页面")} extra={t("每行一个网址；不填写协议时自动使用 HTTPS")}>
        <Input.TextArea rows={4} placeholder={'https://example.com\nhttps://browserleaks.com/'} />
      </Form.Item>
      <Form.Item name="extensionIds" label={t("启动扩展")} extra={t("从扩展管理中导入后，可为每个环境选择不同的扩展组合")}>
        <Select
          mode="multiple"
          allowClear
          placeholder={extensions.length ? t("选择该环境启动时加载的扩展") : t("尚未导入扩展")}
          options={extensions.map((extension) => ({
            value: extension.id,
            label: `${extension.name} · ${extension.version}`
          }))}
        />
      </Form.Item>
      <Divider />
      <Form.Item name={['window', 'mode']} label={t("浏览器窗口")} extra={t("自动模式沿用指纹屏幕尺寸；自定义模式可固定窗口尺寸和桌面坐标。")}>
        <Select options={[{ value: 'auto', label: t("自动尺寸与位置") }, { value: 'custom', label: t("固定尺寸与位置") }]} />
      </Form.Item>
      {windowMode === 'custom' && (
        <>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("窗口尺寸")}>
                <Space.Compact block>
                  <Form.Item name={['window', 'width']} noStyle><InputNumber min={480} max={7680} precision={0} className="resolution-input" /></Form.Item>
                  <Input className="resolution-times" value="×" disabled />
                  <Form.Item name={['window', 'height']} noStyle><InputNumber min={360} max={4320} precision={0} className="resolution-input" /></Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("桌面坐标")}>
                <Space.Compact block>
                  <Form.Item name={['window', 'x']} noStyle><InputNumber min={-20000} max={20000} precision={0} prefix="X" className="resolution-input" /></Form.Item>
                  <Input className="resolution-times" value="," disabled />
                  <Form.Item name={['window', 'y']} noStyle><InputNumber min={-20000} max={20000} precision={0} prefix="Y" className="resolution-input" /></Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
          <Alert type="info" showIcon message={t("多显示器允许负坐标；显示器布局变化后，过期坐标可能让窗口出现在屏幕之外。")} />
        </>
      )}
      <Form.Item name="note" label={t("备注")}>
        <Input.TextArea rows={3} maxLength={500} showCount placeholder={t("仅保存在本机")} />
      </Form.Item>
    </div>
  )

  const proxy = (
    <div className="editor-section">
      <Form.Item name={['proxy', 'protocol']} label={t("代理方式")}>
        <Select
          options={[
            { value: 'direct', label: t("不使用代理（本地网络）") },
            { value: 'http', label: 'HTTP' },
            { value: 'https', label: 'HTTPS' },
            { value: 'socks5', label: 'SOCKS5' }
          ]}
        />
      </Form.Item>
      {proxyProtocol !== 'direct' && (
        <>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item name={['proxy', 'host']} label={t("主机")} rules={[{ required: true, message: t("请输入代理主机") }]}>
                <Input placeholder="proxy.example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={['proxy', 'port']} label={t("端口")} rules={[{ required: true, message: t("请输入端口") }]}>
                <InputNumber min={1} max={65535} className="full-width" placeholder="8080" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name={['proxy', 'username']} label={t("用户名")}>
                <Input autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={t("密码")}
                extra={proxyPasswordStored
                  ? t("已保存；代理地址和用户名未修改时，留空可保持原密码。")
                  : t("密码将安全保存在当前设备。")}
              >
                <Space.Compact block>
                  <Form.Item name={['proxy', 'password']} noStyle>
                    <Input.Password
                      autoComplete="new-password"
                      placeholder={proxyPasswordStored ? t("已保存，留空保持不变") : undefined}
                    />
                  </Form.Item>
                  {proxyPasswordStored && !proxyPassword && (
                    <Button onClick={() => form.setFieldValue(['proxy', 'passwordStored'], false)}>{t("清除已保存")}</Button>
                  )}
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
        </>
      )}
      <Space className="proxy-test-row">
        <Button loading={testingProxy} onClick={() => void testCurrentProxy()}>{t("检测连接")}</Button>
        {proxyResult && !proxyResult.ok && <Typography.Text type="danger">{t("连接失败：{0}", proxyResult.error)}</Typography.Text>}
      </Space>
      {proxyResult?.ok && (
        <div className="proxy-test-result">
          <div className="proxy-result-line">
            <Typography.Text strong>{t("出口 IP：{0}", proxyResult.ip)}</Typography.Text>
            <Typography.Text type="secondary">{proxyResult.latencyMs} ms</Typography.Text>
            {proxyResult.networkRisk && <Tag color="warning">{riskLabels[proxyResult.networkRisk]}</Tag>}
          </div>
          {(proxyResult.country || proxyResult.city) && (
            <Typography.Text type="secondary">
              {[proxyResult.country, proxyResult.region, proxyResult.city].filter(Boolean).join(' · ')}
            </Typography.Text>
          )}
          {(proxyResult.asn || proxyResult.organization || proxyResult.isp) && (
            <Typography.Text type="secondary">
              {[proxyResult.asn ? `AS${proxyResult.asn}` : '', proxyResult.organization, proxyResult.isp]
                .filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' · ')}
            </Typography.Text>
          )}
          {proxyResult.timezone && (
            <div className="proxy-timezone-row">
              <Typography.Text type={proxyResult.geoConfidence === 'conflict' || timezoneMismatch ? 'warning' : 'success'}>
                {t("代理时区：{0}", proxyResult.timezone)} · {proxyResult.geoConfidence === 'conflict'
                  ? t("GeoIP 数据源存在冲突")
                  : timezoneMismatch ? t("与指纹时区 {0} 不一致", fingerprintTimezone) : t("与指纹时区一致")}
              </Typography.Text>
              {timezoneMismatch && proxyResult.geoConfidence !== 'conflict' && (
                <Button size="small" onClick={() => form.setFieldValue(['fingerprint', 'timezone'], proxyResult.timezone)}>{t("应用代理时区")}</Button>
              )}
            </div>
          )}
          {proxyResult.latitude !== undefined && proxyResult.longitude !== undefined && (
            <Typography.Text type="secondary">
              {t("城市级坐标：{0}, {1}", proxyResult.latitude.toFixed(3), proxyResult.longitude.toFixed(3))} · {t("精度约 {0} km", Math.round((proxyResult.accuracyMeters ?? 25000) / 1000))}
            </Typography.Text>
          )}
          {networkIdentityMode === 'proxy' && (
            <Alert
              type={proxyResult.geoConfidence === 'conflict' ? 'warning' : 'success'}
              showIcon
              message={proxyResult.geoConfidence === 'conflict' ? t("代理地理信息存在冲突") : t("代理网络身份已生成")}
              description={proxyResult.geoConfidence === 'conflict'
                ? t("{0}。继续使用可能影响指纹一致性；启动时会再次检测，并由用户确认是否继续。", mt(proxyResult.geoConflict))
                : `${networkIdentity.language} · ${networkIdentity.acceptLanguages} · ${networkIdentity.timezone}`}
            />
          )}
          {proxyResult.degraded && <Typography.Text type="warning">{mt(proxyResult.warning)}</Typography.Text>}
        </div>
      )}
      <Divider />
      <Form.Item
        name={['fingerprint', 'webrtcPolicy']}
        label={t("WebRTC IP 策略")}
        extra={t("视频通话兼容性与网络隐私之间的取舍；普通多环境使用建议保持默认。")}
      >
        <Select
          options={[
            { value: 'proxy_only', label: t("防泄漏（推荐）— 禁止非代理 UDP") },
            { value: 'public_only', label: 'public_only（Apostate 未验证）', disabled: true },
            { value: 'default', label: t("系统默认 — 使用所有网络接口") }
          ]}
        />
      </Form.Item>
      {webrtcPolicy === 'proxy_only' && (
        <Alert
          type="success"
          showIcon
          message={t("WebRTC 防泄漏已开启")}
          description={proxyProtocol === 'direct'
            ? t("不会枚举本地接口；未配置 UDP 代理时 WebRTC 将使用 TCP，部分实时音视频性能可能下降。")
            : t("WebRTC 仅使用代理支持的 UDP 或 TCP，不允许通过本地网络绕过代理。")}
        />
      )}
      {webrtcPolicy === 'public_only' && (
        <Alert
          type="warning"
          showIcon
          message={t("可能暴露真实公网 IP")}
          description={t("该模式隐藏本地网卡地址，但 WebRTC 可以使用系统默认公网接口；使用代理环境时不建议选择。")}
        />
      )}
      {webrtcPolicy === 'default' && (
        <Alert
          type="error"
          showIcon
          message={t("高风险：WebRTC 使用所有接口")}
          description={t("网页可能获取本地网卡或绕过代理的公网地址，仅用于兼容性排障。")}
        />
      )}
    </div>
  )

  const fingerprint = (
    <div className="editor-section">
      <Form.Item
        name={['fingerprint', 'hardwareProfileId']}
        label={t("硬件模板")}
        extra={t("请选择完整硬件组合，避免出现不合理的设备信息。")}
      >
        <Select
          options={[
            ...HARDWARE_PROFILES.map((item) => ({
              value: item.id,
              label: mt(item.label),
              disabled: item.hostMatched && item.platform !== hostPlatform
            })),
            ...(hardwareProfileId === 'legacy-custom' ? [{ value: 'legacy-custom', label: t("旧版自定义配置（保持原指纹）") }] : [])
          ]}
          onChange={(id: HardwareProfileId) => {
            const current = form.getFieldValue('fingerprint')
            form.setFieldValue('fingerprint', applyHardwareProfile(current, id, { refreshSeededGpu: true }))
          }}
        />
      </Form.Item>
      {selectedHardware?.hostMatched && (
        <Alert
          type="success"
          showIcon
          message={t("使用当前设备的硬件信息")}
          description={t("不同环境可能显示相同的硬件信息。")}
        />
      )}
      {selectedHardware && !selectedHardware.hostMatched && (
        <Alert
          type="info"
          showIcon
          message={mt(hardwareProfileSummary(selectedHardware.id))}
          description={t("同一环境的硬件信息保持稳定；重新生成后会获得新的身份。")}
        />
      )}
      <Alert
        type="info"
        showIcon
        message="Apostate 使用 GPU 家族映射"
        description="Prism 的数字 GPU bucket、渲染身份版本和旧版 selective spoofing 参数不会透传到内核。精确 renderer 必须属于所选家族。"
      />
      <Form.Item
        name={['fingerprint', 'gpuAnchor']}
        label="Apostate GPU 家族"
        extra="auto 表示由种子选择；固定家族后可选填精确 WebGL renderer。"
      >
        <Select
          disabled={selectedHardware?.hostMatched}
          options={gpuAnchorOptions}
          onChange={() => form.setFieldValue(['fingerprint', 'gpuRenderer'], undefined)}
        />
      </Form.Item>
      <Form.Item
        name={['fingerprint', 'gpuRenderer']}
        label="WebGL GPU Renderer（可选）"
        extra="必须使用 Apostate GPU catalogue 中与所选家族一致的完整 renderer 字符串；不匹配时内核会拒绝启动。"
      >
        <Input disabled={selectedHardware?.hostMatched || fingerprintGpuAnchor === 'auto'} placeholder="ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 …)" />
      </Form.Item>
      {selectedHardware?.renderIdentityMode === 'seeded-curated' && !selectedGpuIdentity && (
        <Alert
          type="warning"
          showIcon
          message={t("旧环境保持原有硬件信息")}
          description={t("如需更换，请点击下方“重新生成”。")}
        />
      )}
      {hardwareProfileId === 'legacy-custom' && (
        <Alert
          type="warning"
          showIcon
          message={t("这是升级前创建的自定义硬件组合")}
          description={t("为避免已使用环境的指纹突变，当前值不会自动修改。新账号建议新建环境并选择成套硬件模板。")}
        />
      )}
      <Divider />
      <Row gutter={12}>
        <Col span={16}>
          <Form.Item name={['fingerprint', 'seed']} label={t("指纹种子")} rules={[{ required: true }]}>
            <InputNumber disabled={selectedHardware?.hostMatched} min={0} max={0xffffffff} precision={0} className="full-width" />
          </Form.Item>
        </Col>
        <Col span={8} className="seed-action">
          <Button
            disabled={selectedHardware?.hostMatched}
            icon={<ReloadOutlined />}
            onClick={() => {
              const current = form.getFieldValue('fingerprint')
              form.setFieldValue('fingerprint', refreshSeededGpuIdentity({
                ...current,
                seed: randomSeed()
              }))
            }}
          >{t("重新生成")}</Button>
        </Col>
      </Row>
      <div className="form-hint prominent">
        {selectedHardware?.hostMatched
          ? t("不同环境可能共享当前设备的硬件信息。")
          : t("指纹种子决定环境身份。使用中的环境请勿随意修改；复制或重新生成会获得新身份。")}
      </div>
      {selectedHardware?.hostMatched ? (
        <Alert type="info" showIcon message="设备内存：本机自动" description="主机模式不应用合成内存值，保留真实主机身份。" />
      ) : (
        <Form.Item
          name={['fingerprint', 'deviceMemoryGb']}
          label="设备内存（GiB）"
          extra="Apostate 的 --fingerprint-device-memory；超过宿主物理内存的值会在启动前保守限制。硬件模板会固定该值。"
        >
          <InputNumber min={1} max={4096} precision={0} disabled={hardwareProfileId !== 'legacy-custom'} className="full-width" />
        </Form.Item>
      )}
      <Form.Item
        name={['fingerprint', 'canvasWebglNoise']}
        valuePropName="checked"
        label="Canvas / WebGL 读取噪声"
        extra="Apostate 特有的可选像素读取噪声，默认关闭；可能被专门测试检测到，主机模式下无效。"
      >
        <Switch disabled={selectedHardware?.hostMatched} />
      </Form.Item>
      <Divider />
      <Alert
        type="warning"
        showIcon
        message="系统版本由 Apostate 实际内核决定"
        description="abcBrowser 不提供旧 Prism 的系统版本覆盖选项。"
      />
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item
            name={['fingerprint', 'networkIdentityMode']}
            label={t("网络身份")}
            extra={t("自动模式会在启动前检测代理并匹配语言和时区；当前不模拟浏览器 Geolocation API。")}
          >
            <Select disabled={selectedHardware?.hostMatched} options={[
              { value: 'proxy', label: t("跟随代理出口（推荐）") },
              { value: 'manual', label: t("手动固定") }
            ]} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name={['fingerprint', 'proxyExitPolicy']} label={t("出口变化")}>
            <Select options={[
              { value: 'block', label: t("阻止启动并确认（推荐）") },
              { value: 'warn', label: t("仅告警，继续启动") }
            ]} />
          </Form.Item>
        </Col>
      </Row>
      {networkIdentityMode === 'proxy' && !selectedHardware?.hostMatched && (
        <Alert
          type={proxyProtocol === 'direct' ? 'warning' : 'info'}
          showIcon
          message={proxyProtocol === 'direct' ? t("当前没有配置代理") : t("语言和时区将在启动时跟随代理；浏览器 Geolocation API 仍不模拟")}
          description={proxyProtocol === 'direct'
            ? t("直连环境继续使用下方手动值；配置代理后自动联动。")
            : `${networkIdentity.language} · ${networkIdentity.acceptLanguages} · ${networkIdentity.timezone}`}
        />
      )}
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name={['fingerprint', 'hardwareConcurrency']} label={t("CPU 核心数")}>
            <Select disabled={hardwareProfileId !== 'legacy-custom'} options={[2, 4, 6, 8, 10, 12, 14, 16, 20, 24].map((value) => ({ value, label: t("{0} 核", value) }))} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label={t("屏幕分辨率")}>
            <Space.Compact block>
              <Form.Item name={['fingerprint', 'screenWidth']} noStyle>
                <InputNumber disabled={hardwareProfileId !== 'legacy-custom'} min={800} max={7680} precision={0} className="resolution-input" />
              </Form.Item>
              <Input className="resolution-times" value="×" disabled />
              <Form.Item name={['fingerprint', 'screenHeight']} noStyle>
                <InputNumber disabled={hardwareProfileId !== 'legacy-custom'} min={600} max={4320} precision={0} className="resolution-input" />
              </Form.Item>
            </Space.Compact>
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name={['fingerprint', 'language']} label={t("界面语言")}>
            <Input disabled={selectedHardware?.hostMatched || (networkIdentityMode === 'proxy' && proxyProtocol !== 'direct')} placeholder="zh-CN" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name={['fingerprint', 'timezone']} label={t("时区")}>
            <Input disabled={selectedHardware?.hostMatched || (networkIdentityMode === 'proxy' && proxyProtocol !== 'direct')} placeholder="Asia/Shanghai" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name={['fingerprint', 'acceptLanguages']} label="Accept-Language">
        <Input disabled={selectedHardware?.hostMatched || (networkIdentityMode === 'proxy' && proxyProtocol !== 'direct')} placeholder="zh-CN,zh,en-US,en" />
      </Form.Item>
      <Alert
        type="info"
        showIcon
        message="部分旧版指纹开关已隐藏"
        description="Apostate 使用原生 C++ 指纹组合；Canvas/WebGL 只提供可选读取噪声，不提供旧版 Canvas 单项伪装开关。字体、Audio、ClientRects 的旧版单项开关不会透传。"
      />
    </div>
  )

  return (
    <Modal
      open={open}
      title={profile ? t("编辑浏览器环境") : t("新建浏览器环境")}
      width={720}
      destroyOnHidden
      confirmLoading={saving}
      okText={profile ? t("保存修改") : t("创建环境")}
      cancelText={t("取消")}
      onCancel={onCancel}
      onOk={() => void submit()}
    >
      <Typography.Paragraph type="secondary" className="editor-intro">{t("每个环境的数据、指纹和网络设置彼此独立。")}</Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onValuesChange={(changed) => { if ('proxy' in changed) setProxyResult(null) }}
      >
        <Tabs
          defaultActiveKey="general"
          items={[
            { key: 'general', label: t("基础设置"), children: general, forceRender: true },
            { key: 'proxy', label: t("代理设置"), children: proxy, forceRender: true },
            { key: 'fingerprint', label: t("指纹设置"), children: fingerprint, forceRender: true }
          ]}
        />
      </Form>
    </Modal>
  )
}
