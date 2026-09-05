import { PersonalDataManager } from './personalData.js'

const manager = new PersonalDataManager(process.cwd())
const command = process.argv[2] ?? 'status'
const flags = new Set(process.argv.slice(3))

async function main(): Promise<void> {
  if (command === 'status') {
    console.log(JSON.stringify(await manager.getStatus(), null, 2))
    return
  }
  if (command === 'sync') {
    console.log(JSON.stringify(await manager.sync(flags.has('--force')), null, 2))
    return
  }
  if (command === 'restore') {
    console.log(JSON.stringify(await manager.restore(flags.has('--confirm')), null, 2))
    return
  }
  if (command === 'publish') {
    console.log(JSON.stringify(await manager.publish(flags.has('--confirm'), flags.has('--force')), null, 2))
    return
  }
  throw new Error(`未知命令：${command}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
