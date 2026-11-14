from pathlib import Path
from gradientdescentfarmers.source_builder.core.jobs import ProfileJobQueue

def test_submit_idempotent_and_offline_run(farmer,offline_settings,tmp_path):
    queue=ProfileJobQueue(tmp_path/'jobs.sqlite')
    first=queue.submit(farmer,offline_settings)
    second=queue.submit(farmer,offline_settings)
    assert first==second
    assert queue.inspect(first)['status']=='queued'
    done=queue.run_next()
    assert done['job_id']==first
    assert done['status']=='failed'  # no actual environmental data, honestly fails
    assert queue.run_next() is None
    assert (Path(done['output_path'])/'farm_profile.json').exists()

def test_stale_recovery(farmer,offline_settings,tmp_path):
    queue=ProfileJobQueue(tmp_path/'jobs.sqlite')
    key=queue.submit(farmer,offline_settings)
    assert queue.claim_next()['job_id']==key
    assert queue.recover_stale(older_than_minutes=5)==0
