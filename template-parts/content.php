<?php
/**
 * Template part for displaying posts
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/
 *
 * @package restly
 */
$restly_single_post_author = restly_options('restly_single_post_author', true);
$restly_single_post_date = restly_options('restly_single_post_date', true);
$restly_single_post_cmnt = restly_options('restly_single_post_cmnt', true);
$restly_single_post_cat = restly_options('restly_single_post_cat', true);
$restly_single_post_tag = restly_options('restly_single_post_tag', true);
$restly_post_share = restly_options('restly_post_share', false);
$restly_post_top_share = restly_options('restly_post_top_share', false);
if( has_post_thumbnail() or has_post_format( 'video' ,get_the_ID()) or has_post_format( 'audio' ,get_the_ID())){
    $restly_thum_class = 'with-thum-img';
}else{
    $restly_thum_class = 'no-thum-img';
}
$code = 'iframe';
if(get_post_meta( get_the_ID(), 'restly_postmeta_video', true)) {
	$restly_postvideo = get_post_meta( get_the_ID(), 'restly_postmeta_video', true );
}else {
  $restly_postvideo = array();
}
if(get_post_meta( get_the_ID(), 'restly_postmeta_audio', true)) {
	$restly_postaudio = get_post_meta( get_the_ID(), 'restly_postmeta_audio', true );
}else {
  $restly_postaudio = array();
}
if(get_post_meta( get_the_ID(), 'restly_postmeta_gallery', true)) {
	$restly_postgallery = get_post_meta( get_the_ID(), 'restly_postmeta_gallery', true );
    $restly_postgallerys = $restly_postgallery['restly_post_gallery']; // for eg. 15,50,70,125
    $restly_gallery_ids = explode( ',', $restly_postgallerys );
}else {
  $restly_postgallery = array();
}
?>

<article id="post-<?php the_ID(); ?>" <?php post_class('post-details'); ?>>
	<?php 
		if(has_post_format( 'video' ,get_the_ID()) && has_post_thumbnail() ){
			?>
			<div class="post-img">
				<?php the_post_thumbnail('restly-blog-full', array('class' => 'img-responsive')); ?>
				<a href="<?php echo esc_url($restly_postvideo['restly_post_video']); ?>" class="post-video video-popup"><i class="fas fa-play"></i></a>
			</div>
			<?php
		}elseif(has_post_format( 'video' , get_the_ID() ) && !empty($restly_postvideo['restly_post_video'])){
			?>
			<div class="vendor post-img">
				<<?php echo esc_attr($code); ?> width="100%" height="500" src="<?php echo esc_url($restly_postvideo['restly_post_video']); ?>" frameborder="0" allowfullscreen="false"></<?php echo esc_attr($code); ?>>
			</div>
			<?php 
		}elseif(has_post_format( 'audio' , get_the_ID() ) && !empty($restly_postaudio['restly_post_audio'])){
			?>
			<div class="vendor post-img">
				<<?php echo esc_attr($code); ?> width="100%" height="400" src="<?php echo esc_url($restly_postaudio['restly_post_audio']); ?>" frameborder="0" allowfullscreen="false"></<?php echo esc_attr($code); ?>>
			</div>
			<?php 
		}elseif(has_post_format( 'gallery' , get_the_ID() ) && !empty($restly_gallery_ids)){
			?>
				<div class="post-gallerys post-img">
				<?php 
				foreach( $restly_gallery_ids as $gallery_id ){
					echo wp_get_attachment_image( $gallery_id, 'restly-blog-full' );
				}
				?>
				</div>
			<?php 
		}elseif(has_post_thumbnail()){
			?>
			<div class="post-img">
				<?php the_post_thumbnail('full', array('class' => 'img-responsive')); ?>
			</div>
			<?php 
		}
	?>
	<div class="<?php echo esc_attr($restly_thum_class); ?> post-contents entry-content">
		<?php if ( 'post' === get_post_type() ) : ?>
		<div class="post-meta-box d-flex">
			<div class="post-meta-item flex-grow-1">
				<ul>
					<?php if($restly_single_post_author == true ) : ?>
					<li><i class="fas fa-user-alt"></i><?php restly_posted_by(); ?></li>
					<?php endif; ?>
					<?php if($restly_single_post_date == true) : ?>
					<li><i class="fas fa-calendar-alt"></i><?php restly_posted_on(); ?></li>
					<?php endif; ?>
					<?php if($restly_single_post_cmnt == true && get_comments_number() != 0) : ?>
                    <li class="comment-number"><i class="fas fa-comment"></i><?php comments_number( 'no responses', 'one Comment', '% Comments' ); ?>.</li>
                    <?php endif; ?>
					<?php if($restly_single_post_cat == true ) : ?>
					<li class="post-cat"><i class="fas fa-pencil-alt"></i><?php the_category(','); ?></li>
					<?php endif; ?>
				</ul>
			</div>
			<?php if($restly_post_top_share == true ) : ?>
			<div class="post-share">
				<label><?php esc_html_e('Share Now','restly'); ?></label>
				<?php if(function_exists('restly_post_share')){
					restly_post_share();
				} ?>
			</div>
			<?php endif; ?>
		</div>
		<?php endif; ?>
		<div class="post-content">
		<?php
			/* translators: %s: Name of current post */
			the_content(
				sprintf(
					esc_html__( 'Continue reading %s', 'restly' ),
					the_title( '<span class="screen-reader-text">', '</span>', false )
				)
			);
			?>
		</div>
		
		<?php if( has_tag() or function_exists( 'restly_post_share' ) ) : ?>
		<div class="post-tag-social d-flex">
		<?php if($restly_single_post_tag == true ) : ?>
			<div class="post-tag flex-grow-1">
			<?php if(has_tag()) : ?>
				<label><?php esc_html_e('Tags :','restly'); ?></label>	<?php restly_post_tag(); ?>
				<?php endif; ?>
			</div>
			<?php endif; ?>
			<?php if($restly_post_share == true ) : ?>
			<div class="post-share">
				<label><?php esc_html_e('Share','restly'); ?></label>
				<?php if(function_exists('restly_post_share')){
					restly_post_share();
				} ?>
			</div>
			<?php endif; ?>
		</div>
		<?php endif; ?>
	</div>
</article>
