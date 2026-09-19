"""Test the fixed Agent Bridge workspace configuration."""
import json, urllib.request, time, sys, subprocess

# Start Agent Bridge with --root pointing to IDE workspace
cmd = [
    sys.executable, r'C:\Users\jpowe\Desktop\Agent-Bridge\cli.py',
    '--root', r'C:\Users\jpowe\Desktop\IDE-Workspace\workspace',
    '--approval', 'AUTO_SAFE',
    '--preset', 'STANDARD',
    'serve', '--host', '127.0.0.1', '--port', '8477'
]
proc = subprocess.Popen(cmd, cwd=r'C:\Users\jpowe\Desktop\Agent-Bridge', 
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(3)

results = []

# Test health
try:
    with urllib.request.urlopen('http://127.0.0.1:8477/health', timeout=5) as resp:
        results.append('health:PASS')
except Exception as e:
    results.append('health:FAIL(' + str(e)[:50] + ')')

# Test create session with exact allowed root path
sys.path.insert(0, r'C:\Users\jpowe\Desktop\IDE-Workspace\workspace')
sys.path.insert(0, r'C:\Users\jpowe\Desktop\Agent-Bridge')
from client import AgentRuntimeClient

cli = AgentRuntimeClient(base='http://127.0.0.1:8477', token='')
try:
    s = cli.create_session(
        workspace=r'C:\Users\jpowe\Desktop\IDE-Workspace\workspace',
        mode='build',
        approval='AUTO_SAFE',
        model='hhao/qwen2.5-coder-tools:3b'
    )
    sid = s.get('session_id')
    results.append('create_session:PASS(session=' + str(sid)[:8] + ')')
    
    if sid:
        # Submit simple task
        tdata = json.dumps({'text': 'Create a file called test.txt containing exactly HELLO.'}).encode()
        req = urllib.request.Request(
            'http://127.0.0.1:8477/v1/sessions/' + sid + '/tasks', 
            data=tdata, 
            method='POST', 
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=30) as resp2:
            t = json.loads(resp2.read().decode())
            tid = t.get('task_id')
            results.append('task_submitted:' + str(tid)[:8])
            
            # Wait for completion
            for i in range(20):
                time.sleep(3)
                status_req = urllib.request.Request('http://127.0.0.1:8477/v1/sessions/' + sid + '/status')
                with urllib.request.urlopen(status_req, timeout=15) as resp3:
                    st = json.loads(resp3.read().decode())
                    tasks = st.get('tasks', {})
                    task_status = tasks.get(tid, '')
                    if task_status in ('COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK', 'INTERRUPTED'):
                        results.append('task_status:' + task_status)
                        # Get export
                        try:
                            export_req = urllib.request.Request('http://127.0.0.1:8477/v1/sessions/' + sid + '/export?task=' + tid + '&format=markdown')
                            with urllib.request.urlopen(export_req, timeout=15) as resp5:
                                exp = resp5.read().decode()
                                results.append('export:FILES=' + 
                                    (['PASS'] if 'FILES: PASS' in exp else ['FAIL']))
                        except:
                            results.append('export:ERROR')
                        break
except Exception as e:
    results.append('error:' + str(e)[:100])

proc.terminate()

# Print results
print('=== FIX TEST RESULTS ===')
for r in results:
    print(r)
print('=== ===')